export function shouldReloadTeamsToHome({
  hasUser: _hasUser,
  pathname: _pathname,
  search: _search,
  isReload: _isReload
}: {
  hasUser: boolean;
  pathname: string;
  search: string;
  isReload: boolean;
}) {
  return false;
}
