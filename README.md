# Duly
Alexa+ MCP server that turns your household paperwork into answers: deadlines, warranties and plain-language explanations.

## Try it

Duly is a standard remote MCP server (Streamable HTTP, no sign-in). Production endpoint:

```
https://<your-project>.vercel.app/api/mcp
```

It comes with 6 fictional sample documents (marked SAMPLE): an electricity bill, a car insurance renewal, a dishwasher receipt with warranty, a parking notice, a gym auto-renewal and a school field-trip form. All dates are relative to today, so deadlines are always upcoming.

> **Demo storage:** this deployment keeps documents in memory. Documents you add with `add_document` can disappear when Vercel restarts or scales the server; the sample documents always come back. Requests are rate-limited per IP.

### MCP Inspector

1. Run `npx @modelcontextprotocol/inspector` (it opens in your browser).
2. Set **Transport Type** to `Streamable HTTP` and **URL** to the production endpoint above.
3. Click **Connect**, open **Tools**, click **List Tools** and run any of the 6 tools, for example `list_deadlines` with no arguments or `check_warranty` with `product: "dishwasher"`.

From a terminal, you can also call every tool in one go:

```bash
MCP_URL=https://<your-project>.vercel.app/api/mcp npm run tools
```

### Claude (custom connector)

1. In Claude, go to **Customize > Connectors**, click **+ Add**, then **Add custom connector**.
2. Name it `Duly`, paste the production endpoint URL and click **Continue**.
3. Under **Authentication**, choose **No sign in**, then click **Add**.
4. In a chat, click **+** at the lower left, open **Connectors** and turn on **Duly**.

Then ask, for example:

- "What do I need to pay this month?"
- "Is my dishwasher still under warranty?"
- "What happens if I ignore the parking notice?"
- "Write a polite email to Brightwave Energy asking for a two-week payment extension."
- "When does the car insurance renew?"

Duly explains documents; it does not give legal or financial advice.
