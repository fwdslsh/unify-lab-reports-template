export function fixtureEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SITE_|REPORTS_|LAB_)/.test(key)));
}
