import React, { useState, useEffect } from "react";
import "./WorkspaceLoader.css";

export default function WorkspaceLoader({ dbError }) {
  const [bytesLoaded, setBytesLoaded] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);

  const steps = [
    "Allocating in-memory virtual spaces...",
    "Fetching DuckDB WebAssembly binary kernel...",
    "Mounting relational execution matrix layers...",
    "Securing IndexedDB workspace cache slots...",
    "Data pipeline operational shell ready."
  ];

  useEffect(() => {
    const byteInterval = setInterval(() => {
      setBytesLoaded((prev) => {
        if (prev >= 4096) {
          clearInterval(byteInterval);
          return 4096;
        }
        return prev + Math.floor(Math.random() * 256) + 128;
      });
    }, 40);

    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= steps.length - 1) {
          clearInterval(stepInterval);
          return steps.length - 1;
        }
        return prev + 1;
      });
    }, 450);

    return () => {
      clearInterval(byteInterval);
      clearInterval(stepInterval);
    };
  }, []);

  return (
    <div className="loader-overlay-panel">
      <div className="loader-telemetry-box">
        <div className="telemetry-header">
          <div className="telemetry-brand">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1.5" fill="#2563eb" />
              <rect x="9" y="1" width="6" height="6" rx="1.5" fill="#2563eb" opacity=".5" />
              <rect x="1" y="9" width="6" height="6" rx="1.5" fill="#2563eb" opacity=".5" />
              <rect x="9" y="9" width="6" height="6" rx="1.5" fill="#2563eb" opacity=".25" />
            </svg>
            <span>notebook_kernel_init</span>
          </div>
          <span className="telemetry-bytes">
            {bytesLoaded}/4096 KB LOADED
          </span>
        </div>

        <div className="telemetry-progress-track">
          <div 
            className="telemetry-progress-fill" 
            style={{ width: `${(bytesLoaded / 4096) * 100}%` }}
          />
        </div>

        <div className="telemetry-log-terminal">
          {steps.slice(0, currentStep + 1).map((step, index) => {
            const isLast = index === currentStep;
            return (
              <div 
                key={index} 
                className={`terminal-log-line ${isLast ? "line-active" : "line-done"}`}
              >
                <span className="line-timestamp">
                  [{new Date().toLocaleTimeString([], { hour12: false })}]
                </span>
                <span className="line-status-symbol">
                  {index < currentStep ? "✔" : "●"}
                </span>
                <span className="line-text-string">{step}</span>
              </div>
            );
          })}
        </div>

        {dbError && (
          <div className="telemetry-critical-error">
            <h5>⚠ RUNTIME KERNEL PANIC EXCEPTION</h5>
            <pre>{dbError}</pre>
          </div>
        )}
      </div>
    </div>
  );
}