const EXPECTED_INTERACTION_ERRORS = new Set([10008, 10062, 40060]);

// Coletores não aguardam promises dos listeners: toda rejeição precisa terminar aqui.
function guardComponentHandler(handler, context) {
    return (interaction) => {
        Promise.resolve().then(() => handler(interaction)).catch(async (error) => {
            if (EXPECTED_INTERACTION_ERRORS.has(Number(error?.code))) return;
            console.error(context, error);
            const payload = {
                content: '❌ Não consegui concluir ou atualizar esta ação. Confira seu perfil antes de tentar novamente.',
                flags: 64,
            };
            try {
                if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
                else await interaction.reply(payload);
            } catch (replyError) {
                if (!EXPECTED_INTERACTION_ERRORS.has(Number(replyError?.code))) {
                    console.error('Erro ao responder ao componente:', replyError);
                }
            }
        });
    };
}

module.exports = { guardComponentHandler };
