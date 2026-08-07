# Play Console setup values

Use these values for the Play Console fields that are not exposed by the
Google Play Developer publishing API.

## Store setup

| Field | Value |
| --- | --- |
| App or game | App |
| Free or paid | Free |
| Category | Sports |
| Default language | English (United States) — `en-US` |
| Support email | `support@allplays.ai` |
| Website | `https://allplays.ai/support.html` |
| Privacy policy | `https://allplays.ai/privacy.html` |
| Account deletion URL | `https://allplays.ai/account-deletion.html` |

## App-content declarations supported by the current release

- Ads: **No**. The mobile dependency inventory contains no advertising SDK and
  the product does not display ads.
- News app: **No**.
- Target audience: authorized adults managing or following youth sports; the
  app is not designed for children and should not be placed in the Families or
  Kids categories.
- User interaction/user-generated content: **Yes**. The app includes team
  messaging and user-provided team, player, schedule, image, and video content.
- App access: **Some functionality is restricted**. Supply permanent reviewer
  accounts for parent, coach, and team-owner roles plus short navigation steps.
- Payments: disabled for mobile version 1.0.0.

The account owner must personally attest to the Content rating, Target audience,
Data safety, and App access questionnaires. Before submission, audit the exact
release bundle and third-party SDK versions against the Data safety form; do not
copy declarations from TeamSnap, GameChanger, or an older ALL PLAYS build.
