import cron from 'node-cron';
import { runReminderCycle, type CycleResult, type ReminderJobDeps } from './reminderJob.js';

export function formatTick(result: CycleResult, ms: number): string {
  const { claimed, sent, failed, cancelled, retrying, summariesCreated } = result;
  return `[reminders] claimed=${claimed} sent=${sent} failed=${failed} cancelled=${cancelled} retrying=${retrying} summaries=${summariesCreated} (${ms}ms)`;
}

// One pass of the reminder engine with its log line. The cron job and
// `npm run reminders:tick` both run exactly this.
export async function reminderTick(deps: ReminderJobDeps, now?: Date): Promise<CycleResult> {
  const started = Date.now();
  const result = await runReminderCycle(deps, now);
  console.log(formatTick(result, Date.now() - started));
  return result;
}

// Runs a tick every 5 minutes, and once straight away on start-up so nothing waits after
// a restart. Ticks in one process never overlap; across processes, claiming in the
// database keeps any reminder from being sent twice.
export function startScheduler(deps: ReminderJobDeps) {
  let running = false;

  async function tick() {
    if (running) {
      console.log('[reminders] previous run still in progress, skipping this one');
      return;
    }
    running = true;
    try {
      await reminderTick(deps);
    } catch (error) {
      console.error('[reminders] run failed:', error);
    } finally {
      running = false;
    }
  }

  const task = cron.schedule('*/5 * * * *', tick);
  void tick();
  console.log('Reminder scheduler started (every 5 minutes)');
  return { stop: () => task.stop() };
}
