import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const ActiveScanContext = createContext(null);

export function ActiveScanProvider({ children }) {
  const [activeScan, setActiveScan] = useState(() => {
    try {
      const stored = localStorage.getItem('testops_active_scan');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (activeScan) {
      localStorage.setItem('testops_active_scan', JSON.stringify(activeScan));
    } else {
      localStorage.removeItem('testops_active_scan');
    }
  }, [activeScan]);

  // Global background listener for running scans
  useEffect(() => {
    if (activeScan && activeScan.currentStatus === 'running') {
      const es = new EventSource(`${api.baseUrl}/api/test/progress/${activeScan.scanId}`);
      
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.error) {
            updateScanStatus('error');
            es.close();
            return;
          }

          if (data.status === 'completed') {
            updateScanStatus('completed', 100);
            es.close();
          } else if (data.status === 'cancelled') {
            updateScanStatus('cancelled');
            es.close();
          } else if (data.status === 'failed') {
            updateScanStatus('error');
            es.close();
          } else {
            // Update progress without triggering full reload of the connection
            // since we only depend on scanId and currentStatus
            updateScanStatus('running', data.progress || 0);
          }
        } catch (err) {}
      };

      es.onerror = () => {
        es.close();
      };

      return () => {
        es.close();
      };
    }
  }, [activeScan?.scanId, activeScan?.currentStatus]);

  const startActiveScan = (scanId, targetName, scanType) => {
    setActiveScan({
      scanId,
      targetName,
      scanType,
      currentStatus: 'running',
      startedAt: new Date().toISOString(),
      currentProgress: 0,
      routePath: `/scan/live/${scanId}`,
    });
  };

  const updateScanStatus = (status, progress) => {
    setActiveScan((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        currentStatus: status !== undefined ? status : prev.currentStatus,
        currentProgress: progress !== undefined ? progress : prev.currentProgress,
      };
    });
  };

  const clearActiveScan = () => {
    setActiveScan(null);
  };

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
