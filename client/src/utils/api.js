const BASE_URL = 'http://localhost:3001/api';

export const sendAuthenticatedRequest = async (url, method = 'GET', body = null) => {
  const token = localStorage.getItem('token');
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  };

  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${url}`, options);

  if (!response.ok) {
    const error = new Error('Error making authenticated request');
    error.status = response.status;
    throw error;
  }

  return await response.json();
};

export const findUserByUsername = async (username) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${BASE_URL}/users/username/${username}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const error = new Error('Error searching for user');
    error.status = response.status;
    throw error;
  }

  return await response.json();
};

export const getInteractions = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${BASE_URL}/users/interactions`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const error = new Error('Error fetching interactions');
    error.status = response.status;
    throw error;
  }

  return await response.json();
};