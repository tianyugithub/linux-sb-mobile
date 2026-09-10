package expo.modules.linuxnotify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class NotifyBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (
      action != Intent.ACTION_BOOT_COMPLETED
      && action != Intent.ACTION_MY_PACKAGE_REPLACED
      && action != Intent.ACTION_LOCKED_BOOT_COMPLETED
    ) return
    val app = context.applicationContext
    val enabled = NotifyPoller.prefs(app).getBoolean(NotifyPoller.KEY_ENABLED, false)
    if (enabled) NotifyPoller.schedule(app, NotifyPoller.BOOT_DELAY_MS)
  }
}
