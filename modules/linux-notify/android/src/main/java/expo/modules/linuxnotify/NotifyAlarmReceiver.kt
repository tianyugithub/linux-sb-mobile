package expo.modules.linuxnotify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class NotifyAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != NotifyPoller.ACTION_POLL) return
    val pending = goAsync()
    NotifyPoller.runAsync(context.applicationContext) {
      pending.finish()
    }
  }
}
