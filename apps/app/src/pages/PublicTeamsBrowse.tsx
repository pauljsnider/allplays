import { PublicTeamSearch } from '../components/PublicTeamSearch';
import { Link } from 'react-router-dom';

export function PublicTeamsBrowse() {
  return (
    <div className="space-y-4">
      <section className="app-card p-4 sm:p-5">
        <div className="app-label">Teams</div>
        <h1 className="mt-1 text-2xl font-black text-gray-950 sm:text-3xl">Browse public teams</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">
          Find public teams, then open a public-safe profile without loading private roster or schedule data.
        </p>
        <Link to="/discover" className="mt-3 inline-block text-sm font-black text-primary-700">Browse opportunities too →</Link>
      </section>

      <PublicTeamSearch autoBrowseOnMount />
    </div>
  );
}
