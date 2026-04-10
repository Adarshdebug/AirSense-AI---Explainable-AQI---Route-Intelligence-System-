import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Clock3,
  Gauge,
  Leaf,
  Navigation,
  ShieldCheck,
  Waves
} from "lucide-react";

const routeTone = {
  Safe: "var(--brand-safe)",
  Fast: "var(--brand-fast)",
  Balanced: "var(--brand-balanced)"
};

function StatCard({ icon: Icon, label, value, tone }) {
  return (
    <div className="rounded-2xl bg-white/70 p-3 dark:bg-slate-950/70">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        <Icon size={14} style={{ color: tone }} />
        {label}
      </div>
      <div className="text-base font-semibold text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}

function RouteCard({ route, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(route.id)}
      className={`w-full rounded-[24px] border p-4 text-left transition ${
        selected
          ? "border-slate-900 bg-slate-950 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-slate-950"
          : "border-white/30 bg-white/72 text-slate-900 hover:border-slate-300 dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-100"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: routeTone[route.type] || route.riskColor }}
            />
            <span className="font-['Sora'] text-base font-semibold">{route.type}</span>
            {route.isRecommended ? (
              <span className="rounded-full bg-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.22em]">
                Best AQI
              </span>
            ) : null}
          </div>
          <p className={`mt-2 text-sm ${selected ? "text-white/78 dark:text-slate-900/80" : "text-slate-500 dark:text-slate-400"}`}>
            {route.distanceKm} km • {route.estimatedTimeMin} min • Avg AQI {route.averageAqi}
          </p>
        </div>
        <div
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            backgroundColor: selected ? "rgba(255,255,255,0.2)" : `${route.riskColor}20`,
            color: selected ? "inherit" : route.riskColor
          }}
        >
          {route.risk} Risk
        </div>
      </div>
    </button>
  );
}

function LoadingPanel() {
  return (
    <div className="space-y-3 p-4">
      {[1, 2, 3].map((item) => (
        <div key={item} className="skeleton-shimmer h-24 rounded-[24px]" />
      ))}
    </div>
  );
}

export default function RoutePanel({
  routeBundle,
  selectedRouteId,
  onRouteSelect,
  isLoading,
  activeInstruction,
  isMuted
}) {
  const selectedRoute = routeBundle?.routes?.find((route) => route.id === selectedRouteId) || routeBundle?.routes?.[0];

  return (
    <motion.div
      initial={{ y: 120, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-[1200] px-3 pb-3 sm:left-auto sm:w-[440px] sm:px-5 sm:pb-5"
    >
      <div className="glass-panel panel-strong route-panel-scroll max-h-[76vh] overflow-y-auto rounded-t-[30px] rounded-b-[28px] sm:max-h-[calc(100vh-180px)]">
        <div className="sticky top-0 z-10 rounded-t-[30px] bg-[var(--bg-panel-strong)] px-4 pb-3 pt-3 backdrop-blur xl:px-5">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-700 sm:hidden" />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-['Sora'] text-lg font-semibold">Route overview</p>
              <p className="text-muted text-sm">
                Safe, fast, and balanced paths with pollution exposure insights
              </p>
            </div>
            <div className="rounded-full bg-white/70 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-950/70 dark:text-slate-300">
              {isMuted ? "Voice muted" : "Voice active"}
            </div>
          </div>
        </div>

        {isLoading ? <LoadingPanel /> : null}

        {!isLoading && !routeBundle ? (
          <div className="space-y-3 px-4 pb-5 pt-2 text-sm text-slate-600 dark:text-slate-300 xl:px-5">
            <div className="rounded-[24px] bg-white/70 p-4 dark:bg-slate-950/70">
              Search for a route to see live AQI-aware alternatives, voice guidance, and route risk warnings.
            </div>
          </div>
        ) : null}

        {!isLoading && selectedRoute ? (
          <div className="space-y-4 px-4 pb-5 pt-2 xl:px-5">
            <div className="grid gap-3">
              {routeBundle.routes.map((route) => (
                <RouteCard
                  key={route.id}
                  route={route}
                  selected={route.id === selectedRoute.id}
                  onSelect={onRouteSelect}
                />
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={Navigation} label="Distance" value={`${selectedRoute.distanceKm} km`} tone={routeTone[selectedRoute.type]} />
              <StatCard icon={Clock3} label="ETA" value={`${selectedRoute.estimatedTimeMin} min`} tone={routeTone[selectedRoute.type]} />
              <StatCard icon={Leaf} label="Average AQI" value={selectedRoute.averageAqi} tone={selectedRoute.riskColor} />
              <StatCard icon={Gauge} label="Risk" value={selectedRoute.risk} tone={selectedRoute.riskColor} />
            </div>

            <div className="rounded-[26px] bg-white/70 p-4 dark:bg-slate-950/70">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck size={16} style={{ color: routeTone[selectedRoute.type] }} />
                <p className="font-semibold">Live guidance</p>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {activeInstruction || "Voice directions will speak the next maneuver as you move along the route."}
              </p>
            </div>

            <div className="rounded-[26px] bg-white/70 p-4 dark:bg-slate-950/70">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle size={16} style={{ color: selectedRoute.riskColor }} />
                <p className="font-semibold">Pollution advisory</p>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                This route is currently rated <span className="font-semibold">{selectedRoute.risk}</span> risk based on its
                predicted average AQI of <span className="font-semibold">{selectedRoute.averageAqi}</span>.
              </p>
              {selectedRoute.averageAqi > routeBundle.safeLimit ? (
                <div className="mt-3 rounded-2xl bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-300">
                  AQI exceeds the configured safe limit. Expect extra voice warnings near polluted zones.
                </div>
              ) : null}
            </div>

            <div className="rounded-[26px] bg-white/70 p-4 dark:bg-slate-950/70">
              <div className="mb-3 flex items-center gap-2">
                <Waves size={16} className="text-sky-500" />
                <p className="font-semibold">Maneuvers</p>
              </div>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {selectedRoute.steps.slice(0, 8).map((step, index) => (
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ delay: index * 0.03 }}
                      className="flex items-start gap-3 rounded-2xl bg-slate-100/80 px-3 py-3 dark:bg-slate-900/85"
                    >
                      <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {index + 1}
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{step.instruction}</p>
                        <p className="text-muted text-xs">At {Math.round(step.distanceFromStartM)} meters from route start</p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
