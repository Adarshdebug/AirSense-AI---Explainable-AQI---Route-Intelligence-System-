import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bell,
  Compass,
  LoaderCircle,
  Mic,
  MicOff,
  Moon,
  SunMedium
} from "lucide-react";
import MapView from "./components/MapView";
import RoutePanel from "./components/RoutePanel";
import SearchBar from "./components/SearchBar";
import { useVoiceNavigator } from "./components/VoiceNavigator";
import { fetchAreas, fetchAqiOverlay, fetchSafeRoute } from "./lib/api";
import { distanceToRoute, nearestArea } from "./lib/geo";

function ControlButton({ onClick, children, active = false, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`glass-panel flex h-12 w-12 items-center justify-center rounded-2xl transition ${
        active ? "bg-slate-950 text-white dark:bg-emerald-400 dark:text-slate-950" : "text-slate-700 dark:text-slate-100"
      }`}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [areas, setAreas] = useState([]);
  const [overlayPoints, setOverlayPoints] = useState([]);
  const [start, setStart] = useState("Connaught Place");
  const [destination, setDestination] = useState("Saket");
  const [routeBundle, setRouteBundle] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState("safe");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [followUser, setFollowUser] = useState(true);
  const [userPosition, setUserPosition] = useState(null);
  const [alertMessage, setAlertMessage] = useState("");
  const reroutingRef = useRef(false);

  const selectedRoute = useMemo(
    () => routeBundle?.routes?.find((route) => route.id === selectedRouteId) || routeBundle?.routes?.[0],
    [routeBundle, selectedRouteId]
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const [areasResponse, overlayResponse] = await Promise.all([fetchAreas(), fetchAqiOverlay()]);
        if (!active) {
          return;
        }

        setAreas(areasResponse.areas);
        setOverlayPoints(overlayResponse.points);
      } catch (requestError) {
        if (!active) {
          return;
        }
        setError(requestError.message);
      }
    }

    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setAlertMessage("Geolocation is not supported in this browser.");
      return undefined;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserPosition({
          lat: position.coords.latitude,
          lon: position.coords.longitude
        });
      },
      () => {
        setAlertMessage("Live location permission was denied. Search and routing still work.");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const loadRoute = async (nextStart = start, nextDestination = destination, preferredRouteId = selectedRouteId) => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetchSafeRoute(nextStart, nextDestination);
      setRouteBundle(response);
      setSelectedRouteId(preferredRouteId);

      const highlighted = response.routes.find((route) => route.id === preferredRouteId) || response.routes[0];
      if (highlighted?.averageAqi > response.safeLimit) {
        setAlertMessage(`Selected route crosses elevated AQI zones. Average AQI is ${highlighted.averageAqi}.`);
      } else {
        setAlertMessage("");
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedRoute || !userPosition || !areas.length || reroutingRef.current || !routeBundle?.destination) {
      return;
    }

    const offRouteDistance = distanceToRoute(userPosition, selectedRoute);
    if (offRouteDistance < 120) {
      return;
    }

    const nearest = nearestArea(userPosition, areas);
    if (!nearest || nearest.name === routeBundle.destination) {
      return;
    }

    reroutingRef.current = true;
    setAlertMessage(`Route deviation detected. Rerouting from ${nearest.name}.`);
    setStart(nearest.name);

    loadRoute(nearest.name, routeBundle.destination, selectedRouteId).finally(() => {
      reroutingRef.current = false;
    });
  }, [areas, routeBundle?.destination, selectedRoute, selectedRouteId, userPosition]);

  const { activeInstruction, isMuted, setIsMuted, lastHeardCommand } = useVoiceNavigator({
    enabled: Boolean(selectedRoute),
    route: selectedRoute,
    position: userPosition,
    overlayPoints,
    safeLimit: routeBundle?.safeLimit ?? 100,
    onCommand: setSelectedRouteId
  });

  const helperText = error
    ? error
    : lastHeardCommand
      ? `Voice command heard: "${lastHeardCommand}".`
      : "Choose any two supported Delhi NCR areas to compare cleaner and faster routes.";

  return (
    <div className="app-shell">
      <MapView
        key={darkMode ? "dark-map" : "light-map"}
        routeBundle={routeBundle}
        selectedRouteId={selectedRouteId}
        overlayPoints={overlayPoints}
        userPosition={userPosition}
        showHeatmap={showHeatmap}
        followUser={followUser}
        darkMode={darkMode}
      />

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/42 via-transparent to-transparent dark:from-slate-950/20" />

      <SearchBar
        areas={areas}
        start={start}
        destination={destination}
        onStartChange={setStart}
        onDestinationChange={setDestination}
        onSwap={() => {
          setStart(destination);
          setDestination(start);
        }}
        onSubmit={() => loadRoute()}
        isLoading={isLoading}
        helperText={helperText}
        isMobileCompact={window.innerWidth < 640}
      />

      <div className="pointer-events-auto absolute right-3 top-[146px] z-30 flex flex-col gap-3 sm:right-5 sm:top-[154px]">
        <ControlButton
          onClick={() => setFollowUser((value) => !value)}
          active={followUser}
          label="Follow user"
        >
          <Compass size={18} />
        </ControlButton>
        <ControlButton
          onClick={() => setShowHeatmap((value) => !value)}
          active={showHeatmap}
          label="Toggle AQI layer"
        >
          {showHeatmap ? <Bell size={18} /> : <AlertTriangle size={18} />}
        </ControlButton>
        <ControlButton
          onClick={() => setIsMuted((value) => !value)}
          active={!isMuted}
          label="Toggle voice"
        >
          {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
        </ControlButton>
        <ControlButton
          onClick={() => setDarkMode((value) => !value)}
          active={darkMode}
          label="Toggle dark mode"
        >
          {darkMode ? <SunMedium size={18} /> : <Moon size={18} />}
        </ControlButton>
      </div>

      <AnimatePresence>
        {alertMessage ? (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="pointer-events-none absolute left-3 right-20 top-[154px] z-20 sm:left-5 sm:right-[96px] sm:top-[170px]"
          >
            <div className="glass-panel rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-100">
              {isLoading ? (
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle className="animate-spin" size={16} />
                  Updating route and pollution insights...
                </span>
              ) : (
                alertMessage
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <RoutePanel
        routeBundle={routeBundle}
        selectedRouteId={selectedRouteId}
        onRouteSelect={setSelectedRouteId}
        isLoading={isLoading}
        activeInstruction={activeInstruction}
        isMuted={isMuted}
      />
    </div>
  );
}
