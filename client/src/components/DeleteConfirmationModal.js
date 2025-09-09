import React from 'react';
import './DeleteConfirmationModal.css';

const DeleteConfirmationModal = ({ isOpen, onClose, onConfirm, message }) => {
  if (!isOpen) return null;

  return (
    <div className="delete-modal-overlay">
      <div className="delete-modal-content">
        <div className="delete-modal-header">
          <h2>Confirm Deletion</h2>
          <button className="delete-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="delete-modal-body">
          <p>{message}</p>
        </div>
        <div className="delete-modal-footer">
          <button className="delete-confirm-button" onClick={onConfirm}>Delete</button>
          <button className="delete-cancel-button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmationModal;