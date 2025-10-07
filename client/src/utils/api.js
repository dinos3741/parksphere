
const BASE_URL = 'http://localhost:3001/api';

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
