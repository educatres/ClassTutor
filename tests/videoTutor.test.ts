import { describe, expect, it } from 'vitest'
import { parseSbv, parseSrt, parseVtt } from '../src/services/subtitleParser'
import { getEligibleCues, retrieveSources } from '../src/services/retrieval'
import { parseYouTubeVideoId } from '../src/services/youtube'
import { makeCitationCards, parseAIAnswer } from '../src/services/citationValidator'
import { buildChunks } from '../src/services/chunker'
import { zipSync } from 'fflate'
import { readCoursePackage } from '../src/services/coursePackage'

describe('YouTube URL parsing', () => {
  it('accepts supported URL forms and rejects other hosts', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})

describe('subtitle parsing and progress cutoff', () => {
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:05.000\n第一段 &amp; 概念\n\ncue-id\n00:05.000 --> 00:12.000\n<v 老師>第二段'
  it('parses VTT and SRT timings', () => {
    expect(parseVtt(vtt)).toMatchObject([{ start: 0, end: 5, text: '第一段 & 概念' }, { start: 5, end: 12, text: '第二段' }])
    expect(parseSrt('9\r\n00:01:00,000 --> 00:01:02,500\r\n字幕內容')).toMatchObject([{ start: 60, end: 62.5, text: '字幕內容' }])
    expect(parseSbv('0:00:00.000,0:00:02.500\nYouTube SBV 字幕\n\n0:00:02.500,0:00:04.000\n第二段')).toMatchObject([{ start: 0, end: 2.5, text: 'YouTube SBV 字幕' }, { start: 2.5, end: 4, text: '第二段' }])
  })
  it('never retrieves a cue whose end is after cutoff', () => {
    const cues = parseVtt(vtt)
    const eligible = getEligibleCues(cues, 'progress', 5)
    const sources = retrieveSources('概念', eligible, buildChunks(cues))
    expect(sources.every((source) => source.end <= 5)).toBe(true)
  })
})

describe('citation validation', () => {
  it('drops unknown IDs and makes only local citation cards', () => {
    const source = { id: 'chunk_0001', start: 1, end: 2, cueIds: [], text: '證據' }
    const answer = parseAIAnswer('{"status":"answered","answer":"好","citedChunkIds":["chunk_0001","fake"]}', new Set(['chunk_0001']))
    expect(answer.citedChunkIds).toEqual(['chunk_0001'])
    expect(makeCitationCards(answer, [source], 'progress', 2)).toHaveLength(1)
  })
})

describe('compressed course packages', () => {
  it('recognizes .clssstutor archives and requires one .classtutor entry', async () => {
    const archive = zipSync({ 'readme.txt': new TextEncoder().encode('not a course package') })
    await expect(readCoursePackage(new File([archive], 'lesson.clssstutor'))).rejects.toThrow('找不到 .classtutor')
  })
})
