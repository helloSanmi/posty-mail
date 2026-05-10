const baseStyle = [
  'font-family:Arial,sans-serif',
  'max-width:640px',
  'margin:0 auto',
  'padding:32px',
  'color:#1f2937',
].join(';');

const footer = [
  '<p style="font-size:12px;color:#6b7280;margin-top:32px;">',
  '<a href="{{unsubscribeUrl}}">Unsubscribe</a>',
  '</p>',
].join('');

export const defaultTemplates = [
  {
    id: 'launch',
    name: 'Product Launch',
    subject: 'A quick update for {{firstname}}',
    html: [
      `<div style="${baseStyle}">`,
      '<h1 style="font-size:28px;line-height:1.2;margin:0 0 18px;">',
      'A quick update for {{firstname}}</h1>',
      '<p style="font-size:16px;line-height:1.6;">',
      'We are launching a focused update built for teams like yours.</p>',
      '<p style="font-size:16px;line-height:1.6;">',
      'Reply to this email if you want the details.</p>',
      footer,
      '</div>',
    ].join(''),
    text: [
      'Hello {{firstname}},',
      '',
      'We are launching a focused update built for teams like yours.',
      '',
      'Unsubscribe: {{unsubscribeUrl}}',
    ].join('\n'),
  },
  {
    id: 'newsletter',
    name: 'Newsletter',
    subject: 'This month\'s update',
    html: [
      `<div style="${baseStyle}">`,
      '<h1 style="font-size:28px;line-height:1.2;margin:0 0 18px;">',
      'This month\'s update</h1>',
      '<p style="font-size:16px;line-height:1.6;">Hi {{firstname}},</p>',
      '<p style="font-size:16px;line-height:1.6;">',
      'Here are the most useful campaign notes from this month.</p>',
      footer,
      '</div>',
    ].join(''),
    text: [
      'Hi {{firstname}},',
      '',
      'Here are the most useful campaign notes from this month.',
      '',
      'Unsubscribe: {{unsubscribeUrl}}',
    ].join('\n'),
  },
];
