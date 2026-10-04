export function fixtureEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SITE_|REPORTS_|LAB_|CONFIG_FILE$|SNAPSHOT_FILE$|PREVIOUS_FILE$|COLLECT|SSH_KEY_FILE$|SSH_KNOWN_HOSTS_FILE$)/.test(key)));
}
