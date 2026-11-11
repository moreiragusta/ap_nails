import { Link } from 'react-router';
import { Icon, PageHead, SecHead, toast } from '../ui';

type IconName = Parameters<typeof Icon>[0]['name'];
const GROUPS: { title: string; items: { to: string; icon: IconName; label: string; sub: string }[] }[] = [
  {
    title: 'Seu ateliê',
    items: [
      { to: '/admin/servicos', icon: 'scissors', label: 'Serviços e combos', sub: 'Fotos, preços e duração' },
      { to: '/admin/ajustes/horarios', icon: 'clock', label: 'Horários de atendimento', sub: 'Sua semana padrão' },
      { to: '/admin/ajustes/folgas', icon: 'calendar', label: 'Folgas e exceções', sub: 'Feriados, bloqueios e horários especiais' },
      { to: '/admin/ajustes/regras', icon: 'settings', label: 'Regras de agendamento', sub: 'Encaixe, antecedência e janela' },
    ],
  },
  {
    title: 'Comunicação',
    items: [
      { to: '/admin/ajustes/mensagens', icon: 'whatsapp', label: 'Mensagens do WhatsApp', sub: 'Confirmação, lembrete e remarcação' },
      { to: '/admin/ajustes/notificacoes', icon: 'bell', label: 'Notificações e lembretes', sub: 'Avisos no celular' },
    ],
  },
  {
    title: 'Conta',
    items: [
      { to: '/admin/ajustes/negocio', icon: 'sparkle', label: 'Seu negócio', sub: 'Endereço, WhatsApp e Instagram' },
      { to: '/admin/ajustes/clientes-despesas', icon: 'users', label: 'Clientes e despesas', sub: 'Clientes sumidas e categorias' },
      { to: '/admin/ajustes/conta', icon: 'shield', label: 'Senha e segurança', sub: 'Senha, código de recuperação e aparelhos' },
    ],
  },
];

export default function More() {
  const site = location.origin;
  return (
    <div className="page">
      <PageHead title="Mais" />

      <div className="share surface">
        <p>Sua página de agendamento</p>
        <strong>{site.replace(/^https?:\/\//, '')}</strong>
        <div className="two-cols">
          <button type="button" className="btn btn-soft btn-sm" onClick={() => navigator.clipboard?.writeText(site).then(() => toast('Link copiado'))}>
            <Icon name="link" size={18} /> Copiar link
          </button>
          <a className="btn btn-soft btn-sm" href="/" target="_blank" rel="noreferrer"><Icon name="external" size={18} /> Abrir</a>
        </div>
      </div>

      {GROUPS.map((g) => (
        <div key={g.title}>
          <SecHead title={g.title} />
          <div className="rows">
            {g.items.map((it) => (
              <Link key={it.to} to={it.to} className="row-item">
                <span className="menu-icon"><Icon name={it.icon} size={19} /></span>
                <span className="grow"><span className="row-title">{it.label}</span><small>{it.sub}</small></span>
                <Icon name="right" size={18} className="chev" />
              </Link>
            ))}
          </div>
        </div>
      ))}
      <p className="facts" style={{ marginTop: 28 }}>AP Nails · desenvolvido pela NUKKI</p>
    </div>
  );
}
