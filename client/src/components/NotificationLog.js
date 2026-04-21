import React, { useState, useRef, useEffect } from 'react';
import './NotificationLog.css';

const NotificationLog = ({ messages }) => {
  const [height, setHeight] = useState(140); // Initial height
  const isResizing = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(140);
  const containerRef = useRef(null);

  const handleMouseDown = (e) => {
    isResizing.current = true;
    startY.current = e.clientY;
    startHeight.current = height;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'ns-resize'; // Change cursor globally
    e.preventDefault(); // Prevent text selection etc.
  };

  const handleMouseMove = (e) => {
    if (!isResizing.current) return;

    const deltaY = e.clientY - startY.current;
    const newHeight = Math.max(80, startHeight.current - deltaY); // Minimum height of 80px

    setHeight(newHeight);
  };

  const handleMouseUp = () => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'default'; // Reset cursor
  };

  useEffect(() => {
    return () => {
      // Clean up event listeners if component unmounts while resizing
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };
  }, []);

  return (
    <div className="notification-log-container" style={{ height: `${height}px` }} ref={containerRef}>
      <div className="resize-handle" onMouseDown={handleMouseDown}></div>
      <div className="notification-log">
        {messages.map(notification => (
          <div key={notification.id} className="notification-message" style={{ color: notification.color === 'blue' ? 'blue' : notification.color === 'purple' ? 'purple' : notification.color === 'green' ? 'green' : notification.color === 'red' ? 'red' : 'black' }}>
            [{notification.timestamp}] {notification.message}
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotificationLog;
