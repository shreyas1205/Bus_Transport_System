import { useState } from 'react';
import Dialog from './Dialog';

export default function SupportDialog({ onClose }) {
  const [saved, setSaved] = useState(false);
  function download(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const name = event.currentTarget.elements.namedItem('name');
    const message = event.currentTarget.elements.namedItem('message');
    name.setCustomValidity(String(values.get('name')).trim() ? '' : 'Enter your name.');
    message.setCustomValidity(String(values.get('message')).trim().length >= 10 ? '' : 'Describe the issue in at least 10 characters.');
    if (!event.currentTarget.reportValidity()) return;
    const text = `NaviGuard support request\nCreated: ${new Date().toISOString()}\nName: ${values.get('name')}\nReply email: ${values.get('email')}\nTopic: ${values.get('topic')}\n\n${values.get('message')}\n\nLOCAL DRAFT — not submitted or delivered. Share with your college transport office.`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'naviguard-support-request.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  }
  return <Dialog title="Contact support" onClose={onClose}>
    <p>No support delivery service is configured. Prepare a local request, download it, and share it with your college transport office. Nothing is sent automatically.</p>
    <form className="nvg-form" onSubmit={download} onInput={e => e.target.setCustomValidity?.('')}>
      <label>Your name<input name="name" required maxLength={100} autoComplete="name" /></label>
      <label>Reply email<input name="email" type="email" required autoComplete="email" /></label>
      <label>Topic<select name="topic"><option>Account access</option><option>Transport or route</option><option>Fees</option><option>Other</option></select></label>
      <label>How can we help?<textarea name="message" required minLength={10} maxLength={2000} rows={5} onChange={e => { e.target.setCustomValidity(''); setSaved(false); }} /></label>
      <small>Do not include passwords, payment details or other secrets. For urgent safety concerns, contact your campus emergency team directly.</small>
      {saved && <div className="success" role="status">Local request prepared for download. It has not been delivered.</div>}
      <button className="primary">Download support request</button>
    </form>
  </Dialog>;
}
