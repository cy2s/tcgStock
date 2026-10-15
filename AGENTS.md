## Code Review Rules

### Trading eligibility

- Flag changes that permit a simulated trade using a missing or older-than-seven-days market price, or outside 07:00–23:00 Asia/Shanghai. Keep the eligibility checks effective in every order path, including confirmation and execution.

### Account isolation

- Flag changes that mix cash, positions, orders, deposits, or valuations between simulated accounts, or send account state from browser storage to a remote service. Keep each account's records isolated and local to the browser.

### Trade fees

- Flag changes that let a buy or sell bypass the 2.5% fee with a $0.30 minimum, or record balances and order totals that disagree with that fee. Apply the same fee policy to confirmation, execution, and history.
