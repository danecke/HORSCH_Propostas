type ProposalEmailItem = {
  partNumber: string;
  description: string;
  vt: string;
  origin: string;
  ncm: string;
  quantity: number;
  unitPriceCents: number;
  invoiceUnitPriceCents?: number | null;
};

export type ProposalEmailInput = {
  id: string;
  dealership: string;
  recipientName: string;
  recipientEmail: string;
  commercialOwner: string;
  commercialOwnerEmail: string;
  issueDate: string;
  validUntil: string;
  totalCents: number;
  items: ProposalEmailItem[];
  portalUrl: string;
};

export type ProposalEmailResult = {
  status: "sent" | "pending_configuration" | "failed";
  recipientEmail: string;
  error?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

function formatBRL(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function buildHtml(input: ProposalEmailInput) {
  const hasInvoiceUnitPrices = input.items.some((item) => item.invoiceUnitPriceCents !== null && item.invoiceUnitPriceCents !== undefined);
  const invoiceTotalCents = input.items.reduce((sum, item) => sum + (item.invoiceUnitPriceCents ?? 0) * item.quantity, 0);
  const itemRows = input.items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.partNumber)}</td>
          <td>${escapeHtml(item.description)}</td>
          <td>${escapeHtml(item.vt)}</td>
          <td>${escapeHtml(item.origin)}</td>
          <td>${escapeHtml(item.ncm)}</td>
          <td style="text-align:center">${item.quantity}</td>
          <td style="text-align:right">${escapeHtml(formatBRL(item.unitPriceCents))}</td>
          ${hasInvoiceUnitPrices ? `<td style="text-align:right">${escapeHtml(item.invoiceUnitPriceCents === null || item.invoiceUnitPriceCents === undefined ? "—" : formatBRL(item.invoiceUnitPriceCents))}</td>` : ""}
        </tr>`,
    )
    .join("");

  return `<!doctype html>
  <html lang="pt-BR">
    <body style="margin:0;background:#f2f3f4;font-family:Arial,sans-serif;color:#202327">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f2f3f4;padding:28px 12px">
        <tr><td align="center">
          <table role="presentation" width="760" cellspacing="0" cellpadding="0" style="max-width:760px;width:100%;background:#fff;border-top:7px solid #c31727">
            <tr><td style="padding:30px 34px 20px">
              <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#c31727;font-weight:700">HORSCH do Brasil · Peças</div>
              <h1 style="margin:10px 0 5px;font-size:27px">Proposta comercial ${escapeHtml(input.id)}</h1>
              <p style="margin:0;color:#666">${escapeHtml(input.dealership)} · válida até ${formatDate(input.validUntil)}</p>
            </td></tr>
            <tr><td style="padding:0 34px 22px">
              <p>Olá, ${escapeHtml(input.recipientName || "responsável comercial")}.</p>
              <p>A HORSCH encaminha abaixo a proposta comercial para fornecimento de peças. O responsável HORSCH por esta negociação é <strong>${escapeHtml(input.commercialOwner)}</strong>.</p>
              <table width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse;font-size:12px;margin-top:20px">
                <thead><tr style="background:#343a40;color:#fff;text-align:left"><th>PN</th><th>Descrição</th><th>VT</th><th>Origem</th><th>NCM</th><th>Qtd.</th><th style="text-align:right">Netprice unitário</th>${hasInvoiceUnitPrices ? '<th style="text-align:right">Valor unitário de NF</th>' : ""}</tr></thead>
                <tbody>${itemRows}</tbody>
              </table>
              <div style="margin-top:18px;padding:17px 20px;background:#f4f5f5;text-align:right"><span style="color:#666">Valor total de Netprice&nbsp;&nbsp;</span><strong style="font-size:20px">${escapeHtml(formatBRL(input.totalCents))}</strong></div>
              ${hasInvoiceUnitPrices ? `<div style="margin-top:8px;padding:14px 20px;background:#fff7f7;text-align:right"><span style="color:#666">Valor total das NFs&nbsp;&nbsp;</span><strong>${escapeHtml(formatBRL(invoiceTotalCents))}</strong></div>` : ""}
              <p style="margin:25px 0 0"><a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;background:#c31727;color:#fff;text-decoration:none;padding:12px 18px;font-weight:700">Acessar portal de propostas</a></p>
            </td></tr>
            <tr><td style="padding:18px 34px;background:#272b2f;color:#fff;font-size:11px">Documento confidencial · HORSCH do Brasil</td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`;
}

function buildText(input: ProposalEmailInput) {
  const items = input.items
    .map(
      (item) =>
        `${item.partNumber} | ${item.description} | VT ${item.vt} | Origem ${item.origin} | NCM ${item.ncm} | Qtd. ${item.quantity} | Netprice unitário ${formatBRL(item.unitPriceCents)}${item.invoiceUnitPriceCents === null || item.invoiceUnitPriceCents === undefined ? "" : ` | Valor unitário de NF ${formatBRL(item.invoiceUnitPriceCents)}`}`,
    )
    .join("\n");
  return [
    `Proposta comercial ${input.id}`,
    `${input.dealership} · válida até ${formatDate(input.validUntil)}`,
    "",
    `Responsável HORSCH: ${input.commercialOwner}`,
    "",
    items,
    "",
    `Valor total de Netprice: ${formatBRL(input.totalCents)}`,
    input.items.some((item) => item.invoiceUnitPriceCents !== null && item.invoiceUnitPriceCents !== undefined)
      ? `Valor total das NFs: ${formatBRL(input.items.reduce((sum, item) => sum + (item.invoiceUnitPriceCents ?? 0) * item.quantity, 0))}`
      : "",
    `Portal: ${input.portalUrl}`,
  ].join("\n");
}

export async function sendProposalEmail(
  input: ProposalEmailInput,
): Promise<ProposalEmailResult> {
  const { env } = await import("cloudflare:workers");
  const webhookUrl = String(env.PROPOSAL_EMAIL_WEBHOOK_URL ?? "").trim();
  const webhookToken = String(env.PROPOSAL_EMAIL_WEBHOOK_TOKEN ?? "").trim();

  if (!webhookUrl) {
    return {
      status: "pending_configuration",
      recipientEmail: input.recipientEmail,
      error: "O serviço corporativo de e-mail ainda não foi configurado pelo TI.",
    };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
      },
      body: JSON.stringify({
        event: "proposal.sent",
        idempotencyKey: input.id,
        to: [{ email: input.recipientEmail, name: input.recipientName }],
        cc: input.commercialOwnerEmail
          ? [{ email: input.commercialOwnerEmail, name: input.commercialOwner }]
          : [],
        subject: `Proposta comercial HORSCH ${input.id} · ${input.dealership}`,
        html: buildHtml(input),
        text: buildText(input),
        metadata: {
          proposalId: input.id,
          dealership: input.dealership,
          issueDate: input.issueDate,
          validUntil: input.validUntil,
          totalCents: input.totalCents,
        },
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      return {
        status: "failed",
        recipientEmail: input.recipientEmail,
        error: `O serviço de e-mail recusou o envio (${response.status}).`,
      };
    }
    return { status: "sent", recipientEmail: input.recipientEmail };
  } catch (error) {
    return {
      status: "failed",
      recipientEmail: input.recipientEmail,
      error: error instanceof Error ? error.message : "Falha ao enviar o e-mail.",
    };
  }
}
