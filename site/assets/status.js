// This is a periodically collected snapshot, not a streaming monitor.
const stamp = document.getElementById('snapshot-time');
const warning = document.getElementById('snapshot-stale');
function freshness() {
  if (!stamp.dateTime) {
    warning.hidden = true;
    stamp.dataset.state = 'unknown';
    stamp.title = 'No observations have been collected';
    return;
  }
  const observed = Date.parse(stamp.dateTime);
  const age = (Date.now() - observed) / 60000;
  const stale = !Number.isFinite(age) || age > Number(stamp.dataset.staleMinutes) || age < -5;
  warning.hidden = !stale;
  stamp.dataset.state = stale ? 'warn' : 'ok';
  stamp.title = stale ? 'Observation is stale or the clock is ahead' : 'Time of the last observation';
}
if (stamp && warning) {
  freshness();
  setInterval(freshness, 60000);
}
