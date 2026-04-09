import { useEffect, useRef, useState } from "react";
import { distanceBetween, formatDistance, nearestArea } from "../lib/geo";

const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;

function speak(text, mutedRef) {
  if (mutedRef.current || !("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function buildZoneWarning(position, overlayPoints, safeLimit) {
  if (!position || !overlayPoints.length) {
    return null;
  }

  const nearby = nearestArea(position, overlayPoints);
  if (!nearby || nearby.aqi <= safeLimit) {
    return null;
  }

  return `You are entering a high pollution zone near ${nearby.name}. AQI is around ${Math.round(nearby.aqi)}.`;
}

export function useVoiceNavigator({
  enabled,
  route,
  position,
  overlayPoints,
  safeLimit,
  onCommand
}) {
  const [activeInstruction, setActiveInstruction] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [lastHeardCommand, setLastHeardCommand] = useState("");
  const nextStepRef = useRef(0);
  const mutedRef = useRef(false);
  const lastZoneWarningRef = useRef(0);

  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    nextStepRef.current = 0;
    if (route?.steps?.length) {
      const firstStep = route.steps[0];
      setActiveInstruction(`Start navigation. ${firstStep.instruction} in ${formatDistance(firstStep.segmentDistanceM)}.`);
    }
  }, [route]);

  useEffect(() => {
    if (!enabled || !route?.steps?.length || !position) {
      return;
    }

    const currentStep = route.steps[nextStepRef.current];
    if (!currentStep) {
      return;
    }

    const distanceToStep = distanceBetween(position, {
      lat: currentStep.coordinate[1],
      lon: currentStep.coordinate[0]
    });

    if (distanceToStep < 90) {
      const prompt = `${currentStep.instruction} in ${formatDistance(distanceToStep)}.`;
      setActiveInstruction(prompt);
      speak(prompt, mutedRef);
      nextStepRef.current += 1;
    }

    const zoneWarning = buildZoneWarning(position, overlayPoints, safeLimit);
    const now = Date.now();
    if (zoneWarning && now - lastZoneWarningRef.current > 45000) {
      lastZoneWarningRef.current = now;
      setActiveInstruction(zoneWarning);
      speak(zoneWarning, mutedRef);
    }
  }, [enabled, overlayPoints, position, route, safeLimit]);

  useEffect(() => {
    if (!enabled || !SpeechRecognitionApi) {
      return undefined;
    }

    const recognition = new SpeechRecognitionApi();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
      setLastHeardCommand(transcript);

      if (transcript.includes("mute")) {
        setIsMuted(true);
      } else if (transcript.includes("unmute")) {
        setIsMuted(false);
      } else if (transcript.includes("safe")) {
        onCommand?.("safe");
      } else if (transcript.includes("fast")) {
        onCommand?.("fast");
      } else if (transcript.includes("balanced")) {
        onCommand?.("balanced");
      }
    };

    recognition.onerror = () => undefined;
    recognition.onend = () => {
      if (enabled) {
        recognition.start();
      }
    };

    recognition.start();

    return () => {
      recognition.onend = null;
      recognition.stop();
    };
  }, [enabled, onCommand]);

  return {
    activeInstruction,
    isMuted,
    setIsMuted,
    lastHeardCommand
  };
}
