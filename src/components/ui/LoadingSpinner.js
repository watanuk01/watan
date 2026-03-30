import React from 'react';
import './LoadingSpinner.css';

const LoadingSpinner = ({ fullScreen = false, size = 'md', text = '' }) => {
    if (fullScreen) {
        return (
            <div className="loading-fullscreen">
                <div className="loading-content">
                    <div className="loading-logo">
                        <span className="logo-arabic-loading">وطن</span>
                    </div>
                    <div className={`spinner spinner-${size}`} />
                    {text && <p className="loading-text">{text}</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="loading-inline">
            <div className={`spinner spinner-${size}`} />
            {text && <span className="loading-text">{text}</span>}
        </div>
    );
};

export default LoadingSpinner;
