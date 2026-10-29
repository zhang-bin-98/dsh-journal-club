import { describe, expect, it } from 'vitest'
import { parseSkillFile, readJournalClubSkill } from '../src/skill.ts'

describe('journal-club skill file', () => {
  it('reads the packaged SKILL.md with frontmatter metadata', () => {
    const skill = readJournalClubSkill()
    expect(skill.name).toBe('journal-club')
    expect(skill.description.length).toBeGreaterThan(20)
    expect(skill.content.startsWith('# Journal Club')).toBe(true)
    expect(skill.content).not.toContain('description:')
  })

  it('rejects a file without frontmatter', () => {
    expect(() => parseSkillFile('# no frontmatter')).toThrow(/frontmatter/)
  })

  it('handles CRLF line endings', () => {
    const skill = parseSkillFile('---\r\nname: x-y\r\ndescription: d\r\n---\r\nbody')
    expect(skill).toEqual({ name: 'x-y', description: 'd', content: 'body' })
  })
})
