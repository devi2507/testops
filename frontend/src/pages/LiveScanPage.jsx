import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ProgressConsole from '../components/ProgressConsole';
import ResultsDashboard from '../components/ResultsDashboard';
import { useActiveScan } from '../context/ActiveScanContext';
import { useToast } from '../context/ToastContext';
import api from '../services/api';
import '../styles/newScan.css';

export default function LiveScanPage() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { updateScanStatus } = useActiveScan();

  const [phase, setPhase] = useState('progress');
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const handleComplete = async () => {
    updateScanStatus('completed', 100);
    try {
      const data = await api.getResults(testId);
      setResults(data);
      setPhase('results');
      toast?.success('Report generated');
    } catch (err) {
      setError('Failed to retrieve results.');
      toast?.error('Failed to retrieve results.');
    }
  };

  const handleError = (msg) => {
    setError(msg);
    toast?.error(msg);
    updateScanStatus('error', 100);
  };

  if (phase === 'progress') {
    return (
      <div className="newscan-outer">
        <ProgressConsole
          testId={testId}
          onComplete={handleComplete}
          onError={handleError}
        />
      </div>
    );
  }

  if (phase === 'results') {
    return (
      <div className="newscan-outer">
        <ResultsDashboard
          results={results}
          testId={testId}
          onReset={() => navigate('/scan')}
        />
      </div>
    );
  }

  return null;
}
