export function shouldReloadTeamsToHome({
  hasUser,
  pathname,
  search,
  isReload
}: {
  hasUser: boolean;
  pathname: string;
  search: string;
  isReload: boolean;
}) {
  return hasUser && pathname === '/teams' && !search && isReload;
}
