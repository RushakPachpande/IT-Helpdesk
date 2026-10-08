import { describe, expect, it } from 'vitest'
import { cleanEmailBody, htmlToText, textToEmailHtml } from '../src/clean'

describe('cleanEmailBody', () => {
  it('cuts an Outlook web signature that contains a cid image', () => {
    const html = `<div>Hi team,</div><div>My laptop will not charge.</div>
      <div id="Signature"><div>John Smith | Finance</div><img src="cid:image001.png@01DA"><div>+1 555 0100</div></div>`
    expect(cleanEmailBody({ html })).toBe('Hi team,\nMy laptop will not charge.')
  })

  it('cuts Outlook desktop reply history (divRplyFwdMsg)', () => {
    const html = `<p>Still broken after restart.</p><hr style="display:inline-block"><div id="divRplyFwdMsg"><b>From:</b> IT Support<br><b>Sent:</b> Monday</div><div>old message</div>`
    expect(cleanEmailBody({ html })).toBe('Still broken after restart.')
  })

  it('cuts Gmail signatures and quotes', () => {
    const html = `<div dir="ltr">Printer on floor 2 is jammed.<br clear="all"><div><br></div><span class="gmail_signature_prefix">-- </span><br><div dir="ltr" class="gmail_signature">Ana<br>Ops</div></div><br><div class="gmail_quote"><div class="gmail_attr">On Mon, Ana wrote:</div><blockquote>earlier</blockquote></div>`
    expect(cleanEmailBody({ html })).toBe('Printer on floor 2 is jammed.')
  })

  it('cuts a plain-text sign-off and name', () => {
    const text = 'The VPN drops every 10 minutes.\n\nRegards,\nPriya Sharma\nHR Department'
    expect(cleanEmailBody({ text })).toBe('The VPN drops every 10 minutes.')
  })

  it('cuts "Sent from my iPhone"', () => {
    expect(cleanEmailBody({ text: 'Screen is cracked\n\nSent from my iPhone' })).toBe('Screen is cracked')
  })

  it('keeps a one-word "Thanks" reply instead of emptying it', () => {
    expect(cleanEmailBody({ text: 'Thanks' })).toBe('Thanks')
  })

  it('cuts "On ... wrote:" and quoted > lines in plain text', () => {
    const text = 'Works now, thank you.\n\nOn Tue, 7 Oct 2026 at 10:00, IT Support <it@example.com> wrote:\n> Please restart\n> your PC'
    expect(cleanEmailBody({ text })).toBe('Works now, thank you.')
  })

  it('cuts From/Sent header blocks in plain text', () => {
    const text = 'See the attached log.\n\nFrom: IT Support <it@example.com>\nSent: 07 October 2026 10:00\nTo: me\nSubject: RE: [NGI-1]'
    expect(cleanEmailBody({ text })).toBe('See the attached log.')
  })

  it('removes image placeholders and decodes entities', () => {
    expect(cleanEmailBody({ html: '<p>Error [cid:image002.png] shows &quot;Access denied&quot; &amp; exits</p>' })).toBe('Error shows "Access denied" & exits')
    expect(cleanEmailBody({ text: 'Use a &amp; b literally' })).toBe('Use a &amp; b literally')
  })

  it('falls back to (no content) when nothing is left', () => {
    expect(cleanEmailBody({ html: '<div id="Signature">only a signature</div>' })).toBe('(no content)')
  })

  it('truncates very long bodies', () => {
    const out = cleanEmailBody({ text: 'a'.repeat(50) }, 20)
    expect(out).toHaveLength(20)
    expect(out.endsWith('...')).toBe(true)
  })
})

describe('htmlToText / textToEmailHtml', () => {
  it('drops style and script blocks', () => {
    expect(htmlToText('<style>p{color:red}</style><p>Hi</p><script>alert(1)</script>').trim()).toBe('Hi')
  })

  it('escapes HTML and keeps paragraphs', () => {
    const html = textToEmailHtml('Hello <b>\n\nLine two\nnext')
    expect(html).toContain('Hello &lt;b&gt;')
    expect(html).toContain('Line two<br>next')
  })
})
