import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Layers, Route, ShieldCheck } from 'lucide-react';
import { CategoryBadge, RoleBadge, StatusBadge } from '../components/Badges';
import { capabilities } from '../data/capabilities';
import { openPublicUrl } from '../lib/publicActions';

export function CapabilityPage() {
  const { capabilityId } = useParams();
  const capability = capabilities.find((item) => item.id === capabilityId);

  if (!capability) {
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="space-y-4">
      <Link to="/home" className="ghost-button">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Home
      </Link>

      <section className="app-card p-4">
        <div className="flex flex-wrap gap-2">
          <CategoryBadge category={capability.category} />
          <StatusBadge status={capability.status} />
        </div>
        <h1 className="mt-3 text-2xl font-black text-gray-950">{capability.title}</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-gray-600">{capability.summary}</p>
        <PrimaryCapabilityAction capability={capability} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Meta icon={ExternalLink} label="Current site page" value={capability.legacyPath} />
          <Meta icon={Route} label="App route" value={capability.route} />
        </div>
      </section>

      <section className="app-card p-4">
        <div className="flex items-center gap-2 text-sm font-black text-gray-950">
          <Layers className="h-4 w-4 text-primary-600" aria-hidden="true" />
          Feature coverage
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {capability.features.map((feature) => (
            <span key={feature} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-700">
              {feature}
            </span>
          ))}
        </div>
      </section>

      <section className="app-card p-4">
        <div className="flex items-center gap-2 text-sm font-black text-gray-950">
          <ShieldCheck className="h-4 w-4 text-primary-600" aria-hidden="true" />
          Roles
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {capability.roles.map((role) => (
            <RoleBadge key={role} role={role} />
          ))}
        </div>
      </section>
    </div>
  );
}

function PrimaryCapabilityAction({ capability }: { capability: (typeof capabilities)[number] }) {
  if (capability.status === 'native-shell' && capability.route !== `/capabilities/${capability.id}`) {
    return (
      <Link to={capability.route} className="primary-button mt-4 w-full justify-center">
        Open app route
      </Link>
    );
  }

  if ((capability.status === 'stub' || capability.status === 'legacy-link') && capability.legacyPath) {
    const legacyUrl = new URL(capability.legacyPath, 'https://allplays.ai').toString();

    return (
      <button type="button" className="primary-button mt-4 w-full justify-center" onClick={() => void openPublicUrl(legacyUrl)}>
        Open current page
      </button>
    );
  }

  return null;
}

function Meta({ icon: Icon, label, value }: { icon: typeof ExternalLink; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <Icon className="h-4 w-4 text-primary-600" aria-hidden="true" />
      <div className="mt-2 text-[11px] font-extrabold uppercase tracking-[0.04em] text-gray-500">{label}</div>
      <div className="mt-1 break-all text-sm font-black text-gray-950">{value}</div>
    </div>
  );
}
