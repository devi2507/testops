import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../services/api';

const ActiveScanContext = createContext(null);

export function ActiveScanProvider({ children }) {
  const location = useLocation();
  const [activeScan, setActiveScan] = useState(() => {
    try {
      const stored = localStorage.getItem('testops_active_scan');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const activeScanRef = useRef(activeScan);
  activeScanRef.current = activeScan;

  useEffect(() => {
    if (activeScan) {
      localStorage.setItem('testops_active_scan', JSON.stringify(activeScan));
    } else {
      localStorage.removeItem('testops_active_scan');
    }
  }, [activeScan]);

  const updateScanStatus = useCallback((status, progress) => {
    setActiveScan((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        currentStatus: status !== undefined ? status : prev.currentStatus,
        currentProgress: progress !== undefined ? progress : prev.currentProgress,
      };
    });
  }, []);

  // Navbar progress listener — skip on live scan page (ProgressConsole owns that stream)
  useEffect(() => {
    if (location.pathname.includes('/scan/live')) return;

    const scan = activeScanRef.current;
    if (!scan || scan.currentStatus !== 'running') return;

    const es = new EventSource(`${api.baseUrl}/api/test/progress/${scan.scanId}`);
    const terminalSeen = { done: false };

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.error) {
          if (!terminalSeen.done) {
            terminalSeen.done = true;
            updateScanStatus('error');
          }
          es.close();
          return;
        }

        if (data.event === 'heartbeat') {
          if (typeof data.progress === 'number') {
            updateScanStatus('running', data.progress);
          }
          return;
        }

        if (data.status === 'completed' && data.event_key === 'scan_completed') {
          if (!terminalSeen.done) {
            terminalSeen.done = true;
            updateScanStatus('completed', 100);
          }
          es.close();
        } else if (data.status === 'cancelled') {
          if (!terminalSeen.done) {
            terminalSeen.done = true;
            updateScanStatus('cancelled');
          }
          es.close();
        } else if (data.status === 'failed') {
          if (!terminalSeen.done) {
            terminalSeen.done = true;
            updateScanStatus('error');
          }
          es.close();
        } else if (data.status === 'running' && typeof data.progress === 'number') {
          updateScanStatus('running', data.progress);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    es.onerror = () => es.close();

    return () => es.close();
  }, [activeScan?.scanId, activeScan?.currentStatus, location.pathname, updateScanStatus]);

  const startActiveScan = useCallback((scanId, targetName, scanType) => {
    setActiveScan({
      scanId,
      targetName,
      scanType,
      currentStatus: 'running',
      startedAt: new Date().toISOString(),
      currentProgress: 0,
      routePath: `/scan/live/${scanId}`,
    });
  }, []);

  const clearActiveScan = useCallback(() => {
    setActiveScan(null);
  }, []);

  return (
    <ActiveScanContext.Provider
      value={{
        activeScan,
        startActiveScan,
        updateScanStatus,
        clearActiveScan,
      }}
    >
      {children}
    </ActiveScanContext.Provider>
  );
}

export function useActiveScan() {
  return useContext(ActiveScanContext);
}
