import React, { useState } from 'react';
import './RatingModal.css';

const RatingModal = ({ isOpen, onClose, requester, onRate }) => {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);

  if (!isOpen) {
    return null;
  }

  const handleRate = () => {
    onRate(rating);
    onClose();
  };

  return (
    <div className="rating-modal-overlay">
      <div className="rating-modal-content">
        <h2>Rate {requester.requester_username}</h2>
        <p style={{ color: 'black' }}>How was your experience with {requester.requester_username}?</p>
        <div className="rating-stars">
          {[1, 2, 3, 4, 5].map((star) => (
            <span
              key={star}
              className={`star ${
                (hoverRating || rating) >= star ? 'selected' : ''
              }`}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setRating(star)}
            >
              &#9733;
            </span>
          ))}
        </div>
        <button onClick={handleRate} disabled={rating === 0} className="rate-button">
          Rate
        </button>
        <span className="close-icon" onClick={onClose}>&times;</span>
      </div>
    </div>
  );
};

export default RatingModal;
