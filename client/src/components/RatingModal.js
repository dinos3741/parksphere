import React, { useState } from 'react';
import './RatingModal.css';

const RatingModal = ({ isOpen, onClose, onSubmit }) => {
  const [rating, setRating] = useState(0);

  if (!isOpen) {
    return null;
  }

  const handleRating = (rate) => {
    setRating(rate);
  };

  const handleSubmit = () => {
    onSubmit(rating);
  };

  return (
    <div className="rating-modal-overlay">
      <div className="rating-modal-content">
        <h2>Rate the Requester</h2>
        <div className="star-rating">
          {[...Array(5)].map((star, index) => {
            index += 1;
            return (
              <button
                type="button"
                key={index}
                className={index <= rating ? "on" : "off"}
                onClick={() => handleRating(index)}
              >
                <span className="star">&#9733;</span>
              </button>
            );
          })}
        </div>
        <button onClick={handleSubmit} disabled={rating === 0}>
          Submit Rating
        </button>
        <button onClick={onClose}>Skip</button>
      </div>
    </div>
  );
};

export default RatingModal;
