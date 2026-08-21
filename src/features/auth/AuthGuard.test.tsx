import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AuthGuard } from './AuthGuard'

describe('AuthGuard', () => {
  it('redirects an unauthenticated quality manager to login', async () => {
    const auth = { isSignedIn: async () => false }
    const router = createMemoryRouter([
      { path: '/', element: <AuthGuard auth={auth}><p>工作台</p></AuthGuard> },
      { path: '/login', element: <h1>登录页</h1> },
    ], { initialEntries: ['/'] })

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: '登录页' })).toBeVisible()
  })
})
