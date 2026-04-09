import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpDown, LoaderCircle, MapPinned, Search } from "lucide-react";

function Field({ label, value, onChange, areas, placeholder }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-2 rounded-2xl bg-white/80 px-4 py-3 dark:bg-slate-950/70">
      <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <input
        list={`areas-${label}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
      />
      <datalist id={`areas-${label}`}>
        {areas.map((area) => (
          <option key={`${label}-${area.name}`} value={area.name} />
        ))}
      </datalist>
    </label>
  );
}

export default function SearchBar({
  areas,
  start,
  destination,
  onStartChange,
  onDestinationChange,
  onSwap,
  onSubmit,
  isLoading,
  helperText,
  isMobileCompact
}) {
  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="pointer-events-auto absolute inset-x-3 top-3 z-30 mx-auto w-[min(920px,calc(100%-1.5rem))] sm:top-5"
    >
      <div className="glass-panel panel-strong rounded-[30px] p-3 sm:p-4">
        <div className="flex items-center gap-3 px-2 pb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
            <MapPinned size={18} />
          </div>
          <div className="min-w-0">
            <p className="font-['Sora'] text-sm font-semibold sm:text-base">AQI Safest Route Finder</p>
            <p className="text-muted text-xs sm:text-sm">
              Pollution-aware navigation with live map, route risk, and voice guidance
            </p>
          </div>
        </div>

        <div className={`flex ${isMobileCompact ? "flex-col" : "flex-col lg:flex-row"} gap-3`}>
          <Field
            label="Start"
            value={start}
            onChange={onStartChange}
            areas={areas}
            placeholder="Choose origin area"
          />

          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={onSwap}
              className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/40 bg-white/70 text-slate-700 transition hover:scale-[1.02] dark:border-white/10 dark:bg-slate-950/70 dark:text-slate-200"
              aria-label="Swap start and destination"
            >
              <ArrowUpDown size={18} />
            </button>
          </div>

          <Field
            label="Destination"
            value={destination}
            onChange={onDestinationChange}
            areas={areas}
            placeholder="Choose destination area"
          />

          <button
            type="button"
            onClick={onSubmit}
            disabled={isLoading}
            className="flex min-h-[68px] items-center justify-center gap-2 rounded-[22px] bg-slate-950 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400 lg:min-w-[150px]"
          >
            {isLoading ? <LoaderCircle className="animate-spin" size={18} /> : <Search size={18} />}
            {isLoading ? "Routing..." : "Find Route"}
          </button>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={helperText}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="text-muted px-2 pt-3 text-xs sm:text-sm"
          >
            {helperText}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
