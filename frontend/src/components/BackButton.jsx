import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function BackButton({ label = 'Back', fallback = '/dashboard', onClick, className = '' }) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (onClick) {
      onClick();
      return;
    }
    if (window.history.length > 1) navigate(-1);
    else navigate(fallback);
  };

  return (
    <button type="button" className={`back-button ${className}`.trim()} onClick={handleClick}>
      <ArrowLeft size={13} />
      {label}
    </button>
  );
}
