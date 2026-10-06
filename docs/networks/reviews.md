# App reviews

A review is only needed when other people should connect their accounts through **your** developer app, or when a network reviews every app (TikTok, YouTube uploads, LinkedIn Pages, Reddit). For your own accounts, start with the paths in [Choose how to offer each network](index.md), which often need none.

The Postwerk project does not apply on anyone's behalf. Each operator applies for their own server, with their own company details. This page collects what reviewers ask for and how Postwerk helps.

## What every review asks for

| Reviewers ask for | In Postwerk |
|---|---|
| A website describing the app | `${APP_URL}/about`: who runs the server, what it does, which networks |
| A privacy policy | `${APP_URL}/legal/privacy`, written from what Postwerk really stores |
| Terms of service | `${APP_URL}/legal/terms` |
| Data deletion instructions | `${APP_URL}/legal/data-deletion` |
| Contact details, sometimes an imprint | `OPERATOR_EMAIL`, `${APP_URL}/legal/imprint` |
| An https callback URL | `${APP_URL}/api/connect/<network>/callback` (shown on the canvas) |
| A screencast of the real flow | see the script below |
| A test account for the reviewer | create one on your server (Team → invite) |
| Business verification (Meta, LinkedIn Pages, often Google) | your company documents; not something software can provide |

Set `OPERATOR_NAME`, `OPERATOR_EMAIL` and `OPERATOR_ADDRESS` first; see [About and legal pages](../legal.md).

## Screencast script

Reviewers want to see each permission used, in the real app, on your real address. Record in English (or with English captions), at a size where the text is readable, and without cuts in the sign-in.

1. **The website.** Open `${APP_URL}/about`, scroll to the links to the privacy policy and terms.
2. **Sign in to Postwerk** with the test account.
3. **Connect the account.** On the canvas, click the network → **Continue to …**. Show the network's own sign-in and consent screen in full, with the permissions listed, and approve.
4. **Show what each permission is used for.** The connected account appears with its name and picture (the "basic"/"read" permissions); for Facebook, Pinterest and Business Profile, the list of pages, boards or locations to choose from.
5. **Publish.** Write a post in the composer, add an image or video where the network needs one, choose the account and publish now.
6. **Show the result on the network:** the published post, opened from the link in Postwerk's post list.
7. **Disconnect.** Click the account → **Disconnect**, then show `${APP_URL}/legal/data-deletion`.

Name the permissions out loud or in captions as they come up. Keep it to a few minutes.

## Permission texts

Each network's guide has a table of what Postwerk does with each permission, to adapt for the review form:

- [Facebook, Instagram, Threads](meta.md#when-other-people-should-connect)
- [LinkedIn Pages](linkedin.md#company-pages)
- [YouTube and Business Profile](google.md)
- [Pinterest](pinterest.md)
- [Reddit](reddit.md)

Describe your server, not the open-source project: who uses it, which accounts, and why.
