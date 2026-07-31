import { describe, it, expect } from 'vitest'
import { focusTarget } from '../app/utils/focus-target'
import type { ActivitySession } from '../shared/types'

const session = {
  session_key: '1',
  rating_key: '12345',
  media_type: 'episode',
  title: 'Ozymandias',
  show_title: 'Breaking Bad',
  username: 'Alice',
} as ActivitySession

const other = { ...session, session_key: '2', rating_key: '777', username: 'bob' }

const focus = { rating_key: '12345', username: 'alice' }

describe('focusTarget', () => {
  it('finds the session a deep link names', () => {
    expect(focusTarget(focus, [other, session], true, false)).toBe(session)
  })

  it('matches the username case-insensitively', () => {
    expect(focusTarget({ ...focus, username: 'ALICE' }, [session], true, false)).toBe(session)
  })

  it('returns nothing without a focus', () => {
    expect(focusTarget(null, [session], true, false)).toBeNull()
    expect(focusTarget(undefined, [session], true, false)).toBeNull()
  })

  // The regression this function exists for: opening before the shares and
  // pending watches arrive seeds an empty selection, and saving from there
  // strips an existing share.
  it('waits until the dialog data has landed', () => {
    expect(focusTarget(focus, [session], false, false)).toBeNull()
  })

  it('leaves an open dialog alone', () => {
    expect(focusTarget(focus, [session], true, true)).toBeNull()
  })

  it('returns nothing when no session matches', () => {
    expect(focusTarget(focus, [other], true, false)).toBeNull()
    expect(focusTarget(focus, [], true, false)).toBeNull()
  })

  it('does not match the same item played by someone else', () => {
    expect(focusTarget({ ...focus, username: 'bob' }, [session], true, false)).toBeNull()
  })
})
