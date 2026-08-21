import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  it('submits the entered credentials through the injected auth service', async () => {
    const user = userEvent.setup()
    const auth = { signIn: vi.fn().mockResolvedValue(undefined) }
    render(<LoginPage auth={auth} />)
    await user.type(screen.getByLabelText('用户名'), 'linghe')
    await user.type(screen.getByLabelText('密码'), 'test-password')
    await user.click(screen.getByRole('button', { name: '登录' }))
    expect(auth.signIn).toHaveBeenCalledWith('linghe', 'test-password')
  })
})
