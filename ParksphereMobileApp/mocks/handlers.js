import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('*/api/profile', () => {
    return HttpResponse.json({ name: 'Mock User' })
  }),
  
  http.post('*/api/login', async ({ request }) => {
    const body = await request.json()
    const { username } = body

    // Mock different users based on username
    if (username === 'john_doe') {
      return HttpResponse.json({
        token: 'john_token',
        userId: 1,
        username: 'john_doe'
      })
    }

    if (username === 'jane_doe') {
      return HttpResponse.json({
        token: 'jane_token',
        userId: 2,
        username: 'jane_doe'
      })
    }

    // Default mock response
    return HttpResponse.json({ 
      token: 'fake_token',
      userId: 999,
      username: username || 'mock_user'
    })
  }),
]
