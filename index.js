require('dotenv').config()
const express = require('express');
const { App } = require('@slack/bolt');
const app = express();


// initialization of slack Bolt app
const slackApp  = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
})

//Middleware to parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({extended: true}));


slackApp.command('/approval-test', async({command, ack, client}) => {
  await ack();
  // fetch slack for the dropdown
  const users = await client.users.list();
  // for debug purpose
  console.log("All users", users.members.map(u => ({ id: u.id, name: u.real_name || u.name, is_bot: u.is_bot })))
  const userOptions = users.members.filter((user) => !user.is_bot && user.id !== command.user_id) // make bots and user different
  .map((user) => ({
    text: {type: 'plain_text', text: user.real_name || user.name},
    value: user.id
  }));

  //open modal for sending the approval
  await client.views.open({
    trigger_id: command.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'approval_request',
      title: { type: 'plain_text', text: 'Approval Request' },
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'approver_select',
          label: { type: 'plain_text', text: 'Select Approver' },
          element: {
            type: 'static_select',
            action_id: 'approver_select_action',
            placeholder: { type: 'plain_text', text: 'Select a person' },
            options: userOptions,
          },
        },
        {
          type: 'input',
          block_id: 'request_text',
          label: { type: 'plain_text', text: 'Approval Request' },
          element: {
            type: 'plain_text_input',
            action_id: 'request_text_action',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'Enter your request here...' },
          },
        },
      ],
    }
  })

})


// Handle modal submission
slackApp.view('approval_request', async ({ ack, view, client, body }) => {
  await ack();

  const approverId = view.state.values.approver_select.approver_select_action.selected_option.value;
  const requestText = view.state.values.request_text.request_text_action.value;
  const requesterId = body.user.id;

  // Send approval request to approver
  await client.chat.postMessage({
    channel: approverId,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `Approval request from <@${requesterId}>:\n\n${requestText}` },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            action_id: 'approve_action',
            value: JSON.stringify({ requesterId, requestText }),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Reject' },
            style: 'danger',
            action_id: 'reject_action',
            value: JSON.stringify({ requesterId, requestText }),
          },
        ],
      },
    ],
  });
});

// Handle approval/rejection actions
slackApp.action(/approve_action|reject_action/, async ({ action, ack, client, body }) => {
  await ack();

  const { requesterId, requestText } = JSON.parse(action.value);
  const actionType = action.action_id === 'approve_action' ? 'approved' : 'rejected';
  const message = `Your approval request:\n"${requestText}" has been ${actionType} by the approver.`;

  // Notify requester
  await client.chat.postMessage({
    channel: requesterId,
    text: message,
  });

  // Update or delete the original message (optional)
  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: `Approval request has been ${actionType}.`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `Request ${actionType} by <@${body.user.id}>` } },
    ],
  });
});

// Route to handle Slack events (required for interactivity)
app.post('/slack/events', async (req, res) => {
  const payload = req.body;
  if (payload.type === 'url_verification') {
    res.send(payload.challenge);
  } else {
    await slackApp.processEvent(payload);
    res.sendStatus(200);
  }
});

// Route to handle interactive components
app.post('/slack/interactive', async (req, res) => {
  await slackApp.processEvent(req.body.payload);
  res.sendStatus(200);
});

// Start the server

const port = process.env.PORT || 3000;
(async () => {
  await slackApp.start(port);
  console.log(`Slack bot running on port ${port}`)
})();