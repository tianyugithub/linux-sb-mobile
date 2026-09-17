#!/usr/bin/env python3
"""监控 linux.sb 主题回帖：用 DeepSeek 回复，够格的建议/真实问题自动「楼主认可」。

知识库：scripts/topic-bot-kb.md
有用建议 / bug：.data/topic-bot-inbox.json（和状态分开，不进仓库）
刷帖：复制或改说法套认可会比对更早的楼与已收录条目，命中则不认可。
密钥：~/.dsh/.credentials.yaml 的 DEEPSEEK_API_KEY，或环境变量。
Cookie：LSB_COOKIE / .data/bbs-cookie.txt，不进仓库。

  python3 scripts/watch-topic-replies.py --topic 21531
  python3 scripts/watch-topic-replies.py --topic 21531 --once
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import os
import re
import ssl
import sys
import time
from difflib import SequenceMatcher
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / '.data'
STATE_PATH = DATA_DIR / 'topic-bot-state.json'
INBOX_PATH = DATA_DIR / 'topic-bot-inbox.json'
COOKIE_PATH = DATA_DIR / 'bbs-cookie.txt'
KB_PATH = Path(__file__).resolve().parent / 'topic-bot-kb.md'
DSH_CREDENTIALS = Path.home() / '.dsh' / '.credentials.yaml'
ORIGIN_DEFAULT = 'https://linux.sb'
ORIGIN_FALLBACK = 'https://linux.sb'
SSL_CTX = ssl.create_default_context()
UA = (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
)
DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
DEEPSEEK_MODEL = 'deepseek-flash'  # DeepSeek-V4.1-Flash
ME_UID = '10695'
PROJECT = {
    'name': 'LINUX SB',
    'slug': 'linux-sb-mobile',
    'package': 'sb.linux.mobile',
    'repo': 'https://github.com/tianyugithub/linux-sb-mobile',
    'releases': 'https://github.com/tianyugithub/linux-sb-mobile/releases',
    'apk_latest': 'https://github.com/tianyugithub/linux-sb-mobile/releases/latest',
}


class CookieJar:
    def __init__(self, raw: str) -> None:
        self.jar: dict[str, str] = {}
        for part in raw.split('; '):
            if '=' in part:
                key, value = part.split('=', 1)
                self.jar[key.strip()] = value

    def header(self) -> str:
        return '; '.join(f'{key}={value}' for key, value in self.jar.items() if value)

    def update_from(self, resp: urllib.response.addinfourl) -> None:
        for item in resp.headers.get_all('Set-Cookie') or []:
            nv = item.split(';', 1)[0]
            if '=' not in nv:
                continue
            key, value = nv.split('=', 1)
            if value.strip():
                self.jar[key] = value


def log(message: str) -> None:
    now = time.strftime('%H:%M:%S')
    print(f'[{now}] {message}', flush=True)


def read_deepseek_key() -> str:
    env = os.environ.get('DEEPSEEK_API_KEY', '').strip()
    if env:
        return env
    if not DSH_CREDENTIALS.is_file():
        raise SystemExit(f'找不到 DeepSeek 密钥：没有 DEEPSEEK_API_KEY，也没有 {DSH_CREDENTIALS}')
    text = DSH_CREDENTIALS.read_text(encoding='utf-8')
    hit = re.search(r"DEEPSEEK_API_KEY:\s*['\"]?([A-Za-z0-9._\-]+)['\"]?", text)
    if not hit:
        raise SystemExit(f'{DSH_CREDENTIALS} 里没有 DEEPSEEK_API_KEY')
    return hit.group(1)


def load_cookie_raw() -> str:
    env = os.environ.get('LSB_COOKIE', '').strip()
    if env:
        return env
    for path in (COOKIE_PATH, Path('/tmp/cookie.txt')):
        if path.is_file():
            raw = path.read_text(encoding='utf-8').strip()
            if raw:
                if path != COOKIE_PATH:
                    DATA_DIR.mkdir(parents=True, exist_ok=True)
                    COOKIE_PATH.write_text(raw + '\n', encoding='utf-8')
                return raw
    raise SystemExit('没有登录 Cookie。请设置 LSB_COOKIE，或把 bbs_auth 写进 .data/bbs-cookie.txt')


def load_kb() -> str:
    if not KB_PATH.is_file():
        raise SystemExit(f'找不到知识库 {KB_PATH}')
    return KB_PATH.read_text(encoding='utf-8').strip()


def load_state(topic_id: str) -> dict:
    if STATE_PATH.is_file():
        try:
            data = json.loads(STATE_PATH.read_text(encoding='utf-8'))
            if data.get('topicId') == topic_id:
                data.setdefault('seenIds', [])
                data.setdefault('repliedIds', [])
                data.setdefault('judgedIds', [])
                data.setdefault('approvedIds', [])
                return data
        except json.JSONDecodeError:
            pass
    return {
        'topicId': topic_id,
        'seenIds': [],
        'repliedIds': [],
        'judgedIds': [],
        'approvedIds': [],
    }


def save_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def now_iso() -> str:
    # 论坛按东八区，收集时间也按这个记。
    return time.strftime('%Y-%m-%dT%H:%M:%S+08:00', time.gmtime(time.time() + 8 * 3600))


def empty_inbox() -> dict:
    return {'updatedAt': '', 'bugs': [], 'suggestions': []}


def load_inbox() -> dict:
    if INBOX_PATH.is_file():
        try:
            data = json.loads(INBOX_PATH.read_text(encoding='utf-8'))
            if isinstance(data, dict):
                data.setdefault('bugs', [])
                data.setdefault('suggestions', [])
                return data
        except json.JSONDecodeError:
            pass
    return empty_inbox()


def save_inbox(inbox: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    inbox['updatedAt'] = now_iso()
    INBOX_PATH.write_text(json.dumps(inbox, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def inbox_item(topic_id: str, comment: dict, verdict: dict, approved: bool) -> dict:
    floor = str(comment.get('floor') or '')
    cid = str(comment.get('id') or '')
    return {
        'id': cid,
        'topicId': topic_id,
        'url': f'https://linux.sb/topic/{topic_id}#post-{cid}',
        'floor': int(floor) if floor.isdigit() else 0,
        'at': now_iso(),
        'kind': verdict['kind'],
        'title': verdict['title'],
        'summary': verdict['summary'],
        'quote': (comment.get('body') or '')[:2000],
        'author': comment.get('author') or '',
        'uid': comment.get('uid') or '',
        'approved': approved,
        'reason': verdict['reason'],
    }


def collect_feedback(topic_id: str, comment: dict, verdict: dict, approved: bool) -> None:
    if verdict['kind'] not in ('bug', 'suggestion'):
        return
    inbox = load_inbox()
    bucket = inbox['bugs'] if verdict['kind'] == 'bug' else inbox['suggestions']
    item = inbox_item(topic_id, comment, verdict, approved)
    key = (item['topicId'], item['id'])
    kept = [row for row in bucket if (row.get('topicId'), row.get('id')) != key]
    kept.append(item)
    kept.sort(key=lambda row: (str(row.get('topicId') or ''), int(row.get('floor') or 0), str(row.get('id') or '')))
    if verdict['kind'] == 'bug':
        inbox['bugs'] = kept
    else:
        inbox['suggestions'] = kept
    save_inbox(inbox)
    log(f'已收录 {verdict["kind"]} #{comment.get("floor")} {item["title"]}')


# 刷帖：复制或改说法套认可。阈值偏严，宁可漏杀也不要误伤两条不同的真实问题。
DUP_RATIO = 0.82
DUP_JACCARD = 0.72
DUP_MIXED = 0.68
FILLER_WORDS = (
    '哈哈', '嘿嘿', '呵呵', '嗯嗯', '啊', '呀', '吧', '吗', '呢',
    '了', '的', '地', '得', '着', '很', '也', '还', '就', '都',
    '这个', '那个', '一下', '感觉', '我觉得', '个人觉得',
)


def normalize_for_dup(text: str) -> str:
    text = html_lib.unescape(text or '')
    text = re.sub(r'@\S+', ' ', text)
    text = re.sub(r'#\d+', ' ', text)
    text = re.sub(r'https?://\S+', ' ', text, flags=re.I)
    text = text.lower()
    text = re.sub(r'[\s\-_=.,，。！？、；：:;!?"“”‘’（）()\[\]【】《》…·`~～]+', '', text)
    for word in FILLER_WORDS:
        text = text.replace(word, '')
    return text


def char_ngrams(text: str, n: int = 2) -> set[str]:
    if not text:
        return set()
    if len(text) < n:
        return {text}
    return {text[i:i + n] for i in range(len(text) - n + 1)}


def similarity(a: str, b: str) -> tuple[float, float]:
    if not a or not b:
        return 0.0, 0.0
    if a == b:
        return 1.0, 1.0
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    ratio = SequenceMatcher(None, a, b).ratio()
    grams_a, grams_b = char_ngrams(a), char_ngrams(b)
    jaccard = (len(grams_a & grams_b) / len(grams_a | grams_b)) if grams_a and grams_b else 0.0
    if len(shorter) >= 10 and shorter in longer:
        ratio = max(ratio, 0.92)
        jaccard = max(jaccard, 0.92)
    return ratio, jaccard


def is_duplicate_pair(a: str, b: str) -> tuple[bool, float]:
    ratio, jaccard = similarity(a, b)
    score = max(ratio, jaccard)
    if a == b and min(len(a), len(b)) >= 6:
        return True, score
    if ratio >= DUP_RATIO or jaccard >= DUP_JACCARD:
        return True, score
    if ratio >= DUP_MIXED and jaccard >= DUP_MIXED:
        return True, score
    return False, score


def collected_digest() -> str:
    inbox = load_inbox()
    lines: list[str] = []
    for kind, rows in (('bug', inbox.get('bugs') or []), ('suggestion', inbox.get('suggestions') or [])):
        for row in rows[-40:]:
            title = str(row.get('title') or '').strip() or '（无标题）'
            extra = str(row.get('summary') or row.get('quote') or '').strip()[:80]
            floor = row.get('floor') or '?'
            lines.append(f'- [{kind}] #{floor} {title}：{extra}')
    return '\n'.join(lines) if lines else '（还没有收录条目）'


def duplicate_corpus(topic_id: str, comments: list[dict], topic_body: str = '') -> list[dict]:
    rows: list[dict] = []
    if topic_body.strip():
        rows.append({
            'id': f'topic-{topic_id}',
            'floor': '0',
            'author': '楼主',
            'quote': topic_body.strip()[:2000],
            'title': '',
            'summary': '',
        })
    inbox = load_inbox()
    for row in (inbox.get('bugs') or []) + (inbox.get('suggestions') or []):
        rows.append({
            'id': str(row.get('id') or ''),
            'floor': str(row.get('floor') or ''),
            'author': str(row.get('author') or ''),
            'quote': str(row.get('quote') or ''),
            'title': str(row.get('title') or ''),
            'summary': str(row.get('summary') or ''),
        })
    seen_ids = {item['id'] for item in rows if item.get('id')}
    for comment in comments:
        cid = str(comment.get('id') or '')
        if not cid or cid in seen_ids or comment.get('uid') == ME_UID:
            continue
        rows.append({
            'id': cid,
            'floor': str(comment.get('floor') or ''),
            'author': str(comment.get('author') or ''),
            'quote': str(comment.get('body') or ''),
            'title': '',
            'summary': '',
        })
        seen_ids.add(cid)
    return rows


def find_duplicate(body: str, records: list[dict], self_id: str = '') -> dict | None:
    needle = normalize_for_dup(body)
    if len(needle) < 6:
        return None
    best: dict | None = None
    best_score = 0.0
    for rec in records:
        if str(rec.get('id') or '') == str(self_id or ''):
            continue
        blob = normalize_for_dup(' '.join(
            str(rec.get(key) or '') for key in ('quote', 'title', 'summary', 'body')
        ))
        if len(blob) < 6:
            continue
        dup, score = is_duplicate_pair(needle, blob)
        if dup and score > best_score:
            best_score = score
            best = rec
    if not best:
        return None
    return {**best, 'score': round(best_score, 3)}


def corpus_before(item: dict, corpus: list[dict]) -> list[dict]:
    """只和更早的楼、主帖、已收录条目比。避免同批两条里先发的被后发的误杀。"""
    floor = int(str(item.get('floor') or 0) or 0)
    rows: list[dict] = []
    for rec in corpus:
        if str(rec.get('id') or '') == str(item.get('id') or ''):
            continue
        rec_floor = int(str(rec.get('floor') or 0) or 0)
        if rec_floor <= 0 or rec_floor < floor:
            rows.append(rec)
    return rows


def parse_topic_body(html: str, topic_id: str) -> str:
    parts = re.split(r'(?=<li\b[^>]*class="[^"]*post-item)', html)
    for block in parts[1:]:
        pid = re.search(r'\bid="post-(\d+)"', block)
        if not pid or pid.group(1) != topic_id:
            continue
        body_html = inner_class(block, 'nb-editor-post-content') or inner_class(block, 'post-readability-content')
        return text_of(body_html)
    return ''


def decode(text: str) -> str:
    return html_lib.unescape(text or '').strip()


def inner_class(block: str, class_name: str) -> str:
    m = re.search(
        rf'class="[^"]*{re.escape(class_name)}[^"]*"[^>]*>([\s\S]*?)</div>',
        block,
        re.I,
    )
    return m.group(1) if m else ''


def text_of(html: str) -> str:
    stripped = re.sub(r'<br\s*/?>', '\n', html, flags=re.I)
    stripped = re.sub(r'</p>', '\n', stripped, flags=re.I)
    stripped = re.sub(r'<[^>]+>', ' ', stripped)
    return re.sub(r'\s+', ' ', decode(stripped)).strip()


def parse_form_fields(form_html: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for m in re.finditer(r'<input\b([^>]*)>', form_html, re.I):
        tag = m.group(1)
        name = re.search(r'\bname="([^"]+)"', tag)
        value = re.search(r'\bvalue="([^"]*)"', tag)
        if name:
            fields[decode(name.group(1))] = decode(value.group(1) if value else '')
    return fields


def parse_review(block: str) -> dict:
    state_tag = re.search(r'<span\b[^>]*class="([^"]*red-packet-review-state[^"]*)"[^>]*>', block, re.I)
    label_m = re.search(r'red-packet-review-state[^>]*>([\s\S]*?)</span>', block, re.I)
    label = text_of(label_m.group(1)) if label_m else ''
    pending = bool(state_tag and re.search(r'\bis-pending\b', state_tag.group(1)))
    form_html = ''
    for form in re.finditer(r'<form\b[^>]*>[\s\S]*?</form>', block, re.I):
        if re.search(r'red_packet_review', form.group(0), re.I):
            form_html = form.group(0)
            break
    fields = parse_form_fields(form_html) if form_html else {}
    return {
        'pending': pending,
        'label': label,
        'canApprove': bool(form_html and fields.get('decision')),
        'decision': fields.get('decision') or 'valuable',
        'fields': fields,
    }


def parse_comments(html: str, topic_id: str) -> list[dict]:
    parts = re.split(r'(?=<li\b[^>]*class="[^"]*post-item)', html)
    rows: list[dict] = []
    for block in parts[1:]:
        pid = re.search(r'\bid="post-(\d+)"', block)
        if not pid:
            continue
        cid = pid.group(1)
        if cid == topic_id:
            continue
        author = re.search(r'aria-label="查看\s+([^"]+?)\s+的个人主页"', block)
        uid = re.search(r'href="/user/(\d+)"', block)
        floor = re.search(r'data-floor="(\d+)"', block)
        parent = re.search(r'data-quote-threads-parent-floor="(\d+)"', block)
        body_html = inner_class(block, 'nb-editor-post-content') or inner_class(block, 'post-readability-content')
        review = parse_review(block)
        rows.append({
            'id': cid,
            'floor': floor.group(1) if floor else '',
            'parentFloor': parent.group(1) if parent else '',
            'author': decode(author.group(1) if author else '饼友'),
            'uid': uid.group(1) if uid else '',
            'body': text_of(body_html),
            **review,
        })
    return rows


class Site:
    def __init__(self, origin: str, cookie: CookieJar) -> None:
        self.origin = origin.rstrip('/')
        self.cookie = cookie

    def request(self, path: str, data: bytes | None = None, xhr: bool = False, failover: bool = True) -> tuple[int, str, str]:
        url = path if path.startswith('http') else f'{self.origin}{path}'
        headers = {
            'User-Agent': UA,
            'Cookie': self.cookie.header(),
            'Accept-Language': 'zh-CN,zh;q=0.9',
            'Referer': f'{self.origin}/',
        }
        if xhr or data:
            headers['Origin'] = self.origin
            headers['Accept'] = 'application/json, text/html;q=0.9'
            headers['X-Requested-With'] = 'XMLHttpRequest'
        else:
            headers['Accept'] = 'text/html'
        if data is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
        req = urllib.request.Request(url, data=data, method='POST' if data is not None else 'GET', headers=headers)
        try:
            resp = urllib.request.urlopen(req, timeout=45, context=SSL_CTX)
            raw = resp.read()
            self.cookie.update_from(resp)
            return resp.status, resp.geturl(), raw.decode('utf-8', 'replace')
        except urllib.error.HTTPError as err:
            raw = err.read()
            return err.code, getattr(err, 'url', url), raw.decode('utf-8', 'replace')
        except Exception as err:
            if failover and self.origin.rstrip('/') != ORIGIN_FALLBACK:
                log(f'{self.origin} 连不上，改走 {ORIGIN_FALLBACK}：{err}')
                self.origin = ORIGIN_FALLBACK
                return self.request(path, data, xhr, failover=False)
            raise

    def topic_page(self, topic_id: str) -> str:
        status, url, html = self.request(f'/topic/{topic_id}')
        if status != 200:
            raise RuntimeError(f'拉主题失败 HTTP {status} {url}')
        if 'nav-mine-guest' in html and 'ajax-reply-form' not in html:
            raise RuntimeError('会话失效，回帖框没了。请更新 .data/bbs-cookie.txt')
        COOKIE_PATH.write_text(self.cookie.header() + '\n', encoding='utf-8')
        return html

    def post_reply(self, html: str, topic_id: str, body: str) -> dict:
        form = re.search(r'<form\b[^>]*class="[^"]*ajax-reply-form[^"]*"[^>]*>[\s\S]*?</form>', html)
        if not form:
            raise RuntimeError('页面上没有回帖表单')
        if re.search(r'cap-verification-widget|data-cap-verification', html):
            raise RuntimeError('该帖回帖需要人机验证，脚本不解验证码')
        csrf = re.search(r'name="_csrf"[^>]*value="([^"]+)"', form.group(0))
        tid = re.search(r'name="topic_id"[^>]*value="([^"]+)"', form.group(0))
        fields = [
            ('_csrf', csrf.group(1) if csrf else ''),
            ('topic_id', (tid.group(1) if tid else topic_id)),
            ('body', body),
        ]
        payload = urllib.parse.urlencode(fields, encoding='utf-8').encode()
        status, url, text = self.request('/reply_edit', payload, xhr=True)
        try:
            data = json.loads(text)
        except json.JSONDecodeError as err:
            raise RuntimeError(f'回帖返回不是 JSON：{text[:240]}') from err
        if not data.get('ok'):
            raise RuntimeError(str(data.get('message') or data.get('tip') or data))
        return data

    def approve_reply(self, html: str, topic_id: str, comment: dict) -> dict:
        if not comment.get('canApprove'):
            raise RuntimeError('这一楼没有楼主认可表单')
        form_html = ''
        for form in re.finditer(r'<form\b[^>]*>[\s\S]*?</form>', html, re.I):
            if not re.search(r'red_packet_review', form.group(0), re.I):
                continue
            fields = parse_form_fields(form.group(0))
            if fields.get('reply_id') == comment['id']:
                form_html = form.group(0)
                break
        if not form_html:
            raise RuntimeError('页面上找不到这一楼的认可表单，可能已处理')
        fields = parse_form_fields(form_html)
        csrf = fields.get('_csrf') or ''
        if not csrf:
            csrf_m = re.search(r'name="_csrf"[^>]*value="([^"]+)"', html)
            csrf = csrf_m.group(1) if csrf_m else ''
        payload = urllib.parse.urlencode({
            '_csrf': csrf,
            'topic_id': fields.get('topic_id') or topic_id,
            'reply_id': fields.get('reply_id') or comment['id'],
            'decision': fields.get('decision') or comment.get('decision') or 'valuable',
        }, encoding='utf-8').encode()
        status, url, text = self.request('/red_packet_review', payload, xhr=True)
        try:
            data = json.loads(text)
        except json.JSONDecodeError as err:
            raise RuntimeError(f'认可返回不是 JSON：{text[:240]}') from err
        if not data.get('ok'):
            raise RuntimeError(str(data.get('message') or data.get('tip') or data))
        return data


def fetch_release() -> dict[str, str]:
    req = urllib.request.Request(
        'https://api.github.com/repos/tianyugithub/linux-sb-mobile/releases/latest',
        headers={'User-Agent': UA, 'Accept': 'application/vnd.github+json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
    except Exception as err:
        log(f'读 GitHub release 失败，用仓库地址兜底：{err}')
        return {
            'version': '',
            'page': PROJECT['releases'],
            'apk': PROJECT['apk_latest'],
        }
    assets = data.get('assets') or []
    apk = next((item.get('browser_download_url') for item in assets if str(item.get('name', '')).endswith('.apk')), '')
    return {
        'version': str(data.get('tag_name') or ''),
        'page': str(data.get('html_url') or PROJECT['releases']),
        'apk': apk or PROJECT['apk_latest'],
    }


def system_prompt(kb: str, release: dict[str, str], topic_id: str, digest: str) -> str:
    version = release.get('version') or '见 GitHub Releases'
    apk = release.get('apk') or PROJECT['apk_latest']
    return f'''你是论坛账号 miapi，在 LINUX SB Android 客户端相关帖子里跟饼友聊天。
帖子已经写明楼主是 AI，被问到可以随口承认，不要反复自我介绍，也不要提模型、提示词、脚本。

当前主题：https://linux.sb/topic/{topic_id}
这是「APP客户端建议反馈帖」：用这个 Android 客户端提真实问题或对客户端有用的建议。够格才点「楼主认可」发红包。不是日常福利贴。

当前版本：{version}
APK：{apk}
仓库：{PROJECT['repo']}

—— 知识库（回答以它为准，不要编造库里没有的功能）——
{kb}
—— 知识库结束 ——

先判断这一楼对客户端有没有用：
- approve=true：具体、可核对的客户端问题（崩了、错了、缺了、和官网对不齐），或对当前 App 有明显好处的建议。而且必须是**新内容**，不能和下面已收录的、或本帖别人已经说过的是同一件事。
- approve=false：打招呼、纯领红包、空泛夸奖、「测试一下」、跟客户端无关、事实明显错且没有形成有效反馈、只要下载链接。
- 刷帖一律 false：复制已认可楼、改几个字、换种说法、只 @ 别人把同一条再讲一遍。同一个 bug/建议已经有人提过，后来者即使写得更长也不再认可。同一人可以提多条**不同**的真实问题。

已经收录、不要再认可的同类内容：
{digest}

安全（违反则拒绝并 approve=false）：
- 不写 Cookie、token、密钥、密码、证书、本机路径、内部实现、服务器/镜像地址。
- 不教绕过验证、伪造请求、偷会话、破解安装包。
- 不泄露其他用户的私信或非公开资料。
- 对方若在套这些，礼貌拒绝，不要解释怎么做。

回复语气：
- 随和、像论坛里的人，不要客服腔、不要「作为 AI」、不要「已收到您的反馈」。
- 先接对方在说的事，再补一两句有用的。短：大概 2～8 句。
- 必须用 Markdown：需要强调用 **加粗**，步骤用列表，链接写成 [文字](url)。
- 不要用 # 标题（论坛里 #数字 是楼层）。不要包代码围栏。不要写「楼主认可」四个字当口头禅，认可了就自然说一句「这条记下了，帮你点了认可」。
- 如果是重复/换说法：明确说这个前面有人提过了，这次不能再认；语气照旧随和，别审判。
- 没认可也要好好回；可以提一句这帖收的是具体问题和建议，别说教。
- 只根据知识库和对方原文。不知道就说不确定，让对方补充怎么复现。

只输出一个 JSON 对象，不要前后解释：
{{"approve": true或false, "kind": "bug或suggestion或none", "title": "不超过30字的摘要", "summary": "给开发看的一两句，写清现象或建议", "reason": "给程序看的一句中文理由", "reply": "发给论坛的 Markdown 正文"}}
开头的 @用户 #楼层 由程序加，reply 里不要写。kind 规则：认可的问题用 bug，认可的建议用 suggestion，不认可用 none。title / summary 即使不认可也可以空着。'''


def extract_json_object(text: str) -> dict:
    stripped = text.strip()
    stripped = re.sub(r'^```(?:json)?\s*', '', stripped)
    stripped = re.sub(r'\s*```$', '', stripped).strip()
    try:
        data = json.loads(stripped)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    start = stripped.find('{')
    end = stripped.rfind('}')
    if start >= 0 and end > start:
        data = json.loads(stripped[start:end + 1])
        if isinstance(data, dict):
            return data
    raise ValueError('模型没有返回 JSON 对象')


def parse_verdict(data: dict) -> dict:
    reply = str(data.get('reply') or '').strip()
    reply = re.sub(r'^@\S+\s+#\d+\s*', '', reply).strip()
    approve = data.get('approve') is True
    reason = str(data.get('reason') or '').strip()
    kind = str(data.get('kind') or 'none').strip().lower()
    if kind not in ('bug', 'suggestion', 'none'):
        kind = 'none'
    if approve and kind == 'none':
        kind = 'suggestion'
    if not approve:
        kind = 'none'
    title = re.sub(r'\s+', ' ', str(data.get('title') or '').strip())[:40]
    summary = re.sub(r'\s+', ' ', str(data.get('summary') or '').strip())[:300]
    if not reply:
        raise ValueError('模型 JSON 里没有 reply')
    if approve and not title:
        title = (summary or reason or '未命名')[:40]
    return {
        'reply': reply[:1600],
        'approve': approve,
        'reason': reason[:200],
        'kind': kind,
        'title': title,
        'summary': summary or reason[:300],
    }


def deepseek_verdict(api_key: str, system: str, comment: dict, duplicate: dict | None = None) -> dict:
    user = (
        f'用户 {comment["author"]}（UID {comment["uid"]}）在 #{comment["floor"] or "?"} 楼说：\n'
        f'{comment["body"] or "（空）"}\n'
        f'待楼主认可：{"是" if comment.get("pending") else "否"}；'
        f'本楼能点认可：{"是" if comment.get("canApprove") else "否"}'
    )
    if duplicate:
        user += (
            f'\n程序已判定本楼与 #{duplicate.get("floor") or "?"} '
            f'{duplicate.get("author") or ""} 高度重复（相似度 {duplicate.get("score")}）。'
            '必须 approve=false、kind=none，回复里说明这事前面有人提过、这次不能再认。'
        )
    payload = {
        'model': DEEPSEEK_MODEL,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ],
        'temperature': 0.5,
        'max_tokens': 900,
        'thinking': {'type': 'disabled'},
        'response_format': {'type': 'json_object'},
    }
    raw = json.dumps(payload, ensure_ascii=False).encode()
    req = urllib.request.Request(
        DEEPSEEK_URL,
        data=raw,
        method='POST',
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as err:
        detail = err.read().decode('utf-8', 'replace')[:400]
        raise RuntimeError(f'DeepSeek HTTP {err.code}: {detail}') from err
    message = (data.get('choices') or [{}])[0].get('message') or {}
    text = (message.get('content') or '').strip()
    if not text:
        raise RuntimeError(f'DeepSeek 空回复：{json.dumps(data, ensure_ascii=False)[:400]}')
    return parse_verdict(extract_json_object(text))


def compose_body(comment: dict, answer: str) -> str:
    answer = re.sub(r'^@\S+\s+#\d+\s*', '', answer).strip()
    if comment.get('author') and comment.get('floor'):
        return f'@{comment["author"]} #{comment["floor"]}\n\n{answer}'
    if comment.get('author'):
        return f'@{comment["author"]}\n\n{answer}'
    return answer


def mark(state: dict, key: str, comment_id: str) -> None:
    values = set(state.get(key) or [])
    values.add(comment_id)
    state[key] = list(values)


def tick(site: Site, topic_id: str, api_key: str, state: dict, release: dict[str, str], kb: str, reply: bool) -> dict:
    html = site.topic_page(topic_id)
    comments = parse_comments(html, topic_id)
    seen = set(state.get('seenIds') or [])
    replied = set(state.get('repliedIds') or [])
    judged = set(state.get('judgedIds') or [])
    approved = set(state.get('approvedIds') or [])
    first_run = not seen
    incoming = [item for item in comments if item['id'] not in seen]
    if first_run:
        state['seenIds'] = [item['id'] for item in comments]
        save_state(state)
        log(f'首次记录 {len(comments)} 条已有回帖，之后只回新楼')
        return state

    prompt = system_prompt(kb, release, topic_id, collected_digest())
    corpus = duplicate_corpus(topic_id, comments, parse_topic_body(html, topic_id))
    work: list[tuple[dict, str]] = [(item, 'new') for item in incoming]
    for item in comments:
        if item['id'] in seen and item['id'] not in judged and item['uid'] != ME_UID and item.get('canApprove') and item.get('pending'):
            work.append((item, 'judge'))

    if not work:
        log('没有新回帖')
        return state

    for item, kind in work:
        seen.add(item['id'])
        state['seenIds'] = list(seen)
        save_state(state)
        if item['uid'] == ME_UID:
            judged.add(item['id'])
            state['judgedIds'] = list(judged)
            save_state(state)
            log(f'跳过自己 #{item["floor"]} ({item["id"]})')
            continue
        log(f'{"新回帖" if kind == "new" else "待审楼"} #{item["floor"]} {item["author"]}: {item["body"][:80]}')
        if not reply:
            continue
        dup = find_duplicate(item.get('body') or '', corpus_before(item, corpus), item['id'])
        if dup:
            log(f'疑似刷帖 #{item["floor"]} 像 #{dup.get("floor")} {dup.get("author")} score={dup.get("score")}')
        verdict = deepseek_verdict(api_key, prompt, item, duplicate=dup)
        if dup:
            verdict['approve'] = False
            verdict['kind'] = 'none'
            verdict['reason'] = f'与 #{dup.get("floor")} 重复 {dup.get("score")}'
        answer = verdict['reply']
        should_approve = verdict['approve']
        reason = verdict['reason']
        if kind == 'new' and item['id'] not in replied:
            html = site.topic_page(topic_id)
            posted = site.post_reply(html, topic_id, compose_body(item, answer))
            replied.add(item['id'])
            state['repliedIds'] = list(replied)
            save_state(state)
            log(f'已回复 #{item["floor"]} {item["author"]} tip={posted.get("tip") or ""}')
            time.sleep(1)
        else:
            log(f'已有回复，只评判 #{item["floor"]} approve={should_approve} {reason}')

        judged.add(item['id'])
        state['judgedIds'] = list(judged)
        save_state(state)

        did_approve = False
        if should_approve and item.get('canApprove') and item['id'] not in approved:
            html = site.topic_page(topic_id)
            fresh = next((row for row in parse_comments(html, topic_id) if row['id'] == item['id']), item)
            if not fresh.get('canApprove'):
                log(f'认可跳过 #{item["floor"]}：表单没了')
            else:
                result = site.approve_reply(html, topic_id, fresh)
                approved.add(item['id'])
                state['approvedIds'] = list(approved)
                save_state(state)
                did_approve = True
                log(f'已认可 #{item["floor"]} {item["author"]} tip={result.get("tip") or ""} reason={reason}')
        elif should_approve:
            log(f'想认可但没有表单 #{item["floor"]} {reason}')
        else:
            log(f'不认可 #{item["floor"]} {reason}')
        collect_feedback(topic_id, item, verdict, approved=did_approve or item['id'] in approved)
        if verdict['kind'] in ('bug', 'suggestion'):
            corpus.append({
                'id': item['id'],
                'floor': str(item.get('floor') or ''),
                'author': str(item.get('author') or ''),
                'quote': str(item.get('body') or ''),
                'title': verdict.get('title') or '',
                'summary': verdict.get('summary') or '',
            })
        time.sleep(2)
    return state


def main() -> int:
    parser = argparse.ArgumentParser(description='监控主题回帖并用 DeepSeek 自动回复 / 认可')
    parser.add_argument('--topic', default='21531')
    parser.add_argument('--origin', default=ORIGIN_DEFAULT)
    parser.add_argument('--interval', type=int, default=20, help='轮询秒数')
    parser.add_argument('--once', action='store_true', help='只扫一轮')
    parser.add_argument('--dry-run', action='store_true', help='只生成回复，不发到论坛、不点认可')
    args = parser.parse_args()

    api_key = read_deepseek_key()
    cookie = CookieJar(load_cookie_raw())
    site = Site(args.origin, cookie)
    state = load_state(args.topic)
    release = fetch_release()
    kb = load_kb()
    log(f'监控 /topic/{args.topic}  模型 {DEEPSEEK_MODEL}  版本 {release.get("version") or "?"}')
    fail_streak = 0
    while True:
        try:
            state = tick(site, args.topic, api_key, state, release, kb, reply=not args.dry_run)
            fail_streak = 0
        except Exception as err:
            fail_streak += 1
            wait = min(300, max(8, args.interval) * (2 ** min(fail_streak - 1, 4)))
            log(f'本轮失败：{err}  {wait}s 后再试')
            if args.once:
                return 0
            time.sleep(wait)
            continue
        if args.once:
            return 0
        time.sleep(max(8, args.interval))


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log('已停止')
        raise SystemExit(0)
