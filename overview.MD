## Inspiration
Everyone loves to gamble. But if betting's too hard, everyone has an easy excuse to back out of a bet. We built something that forces you to put your money where your mouth is. 

## What it does
BAAM is connected to the Solana network and stakes your money using crypto. You can stake Solana on a bet and send that bet to your friend. When your friend accepts, that money gets put in escrow and it gets locked away safely until the bet resolves. In a group setting, that means having other people approve the payout. Or you can bet on sports games and have the outcome automatically resolve.

## How we built it
We had an on-chain program that holds funds in escrow and allows users to stake money on personal and sports bets. A relayer hosted on our Vultr VPS runs our Discord.js bot, an API to settle sports bets, and connects to MongoDB to host our information. Our web app is also hosted on our Vultr VPS and enables our native group chat and betting capabilities. We also built an iMessage extension that uses your web login to more easily send bets.

## Challenges we ran into
Coordination and collaboration. Having everyone work together on so many different parts of the app at once was difficult, and ensuring that all our work did not end up conflicting with each other. 

## Accomplishments that we're proud of
We built a real Solana program that actually escrows funds and settles two different bet types. We built 3 different ways to access the betting so that the betting goes where your conversations are. We also made our VPS auto redeploy with each new push to main.

## What we learned
For many of us, this was our first hackathon. This was our first time working under pressure and using git to share code, as well as our first introduction to heavy use of AI coding tools. Without these tools, we would not have been able to make our app as fleshed out as it is.

## What's next for BAAM
Finishing out the final touches and transferring this project from the Solana devnet to the mainnet.