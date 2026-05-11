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
  {
    id: 'image-banner',
    name: 'Image banner',
    subject: '{{firstname}}, take a look',
    // No `padding` on the outer wrapper. The banner image sits edge-to-edge
    // inside the email body, the way mobile-app announcements and promo
    // campaigns are usually designed. A tight unsubscribe footer sits below
    // (live text needed for deliverability. Pure-image emails get flagged
    // as spam more aggressively).
    html: [
      '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1f2937;">',
      // Replace this <img> with your own via the Insert image button.
      // Default click-through URL is just a placeholder. Set it on insert.
      '<a href="#" style="display:block;text-decoration:none;">',
      '<img src="https://via.placeholder.com/600x300?text=Replace+me+with+your+banner" alt="Campaign banner" style="display:block;max-width:600px;width:100%;height:auto;margin:0 auto;border:0;">',
      '</a>',
      '<p style="font-size:12px;color:#6b7280;text-align:center;margin:20px 12px;line-height:1.5;">',
      'You\'re receiving this because you signed up.<br>',
      '<a href="{{unsubscribeUrl}}" style="color:#6b7280;">Unsubscribe</a>',
      '</p>',
      '</div>',
    ].join(''),
    text: [
      'Hi {{firstname}},',
      '',
      'View this campaign in your inbox. It includes an image that may not',
      'render here.',
      '',
      'Unsubscribe: {{unsubscribeUrl}}',
    ].join('\n'),
  },
];
