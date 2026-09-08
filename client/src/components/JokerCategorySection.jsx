import { useEffect, useRef, useState } from 'react';
import JokerCard from './JokerCard.jsx';
import { useI18n } from '../hooks/useI18n.jsx';

// Une section par catégorie : même DOM en desktop et mobile (voir le CSS),
// seule la mise en page change. Le suivi de position ne sert visuellement
// qu'en dessous de 640px (les points sont masqués au-delà par CSS), mais
// tourne sans condition — inoffensif sur desktop où il ne s'affiche jamais.
function JokerCategorySection({ categorie, selectedCarteJokerId, onChoose }) {
  const { t } = useI18n();
  const scrollerRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const first = el.children[0];
      if (!first) return;
      const step = first.getBoundingClientRect().width + parseFloat(getComputedStyle(el).gap || '0');
      setActiveIndex(Math.round(el.scrollLeft / step));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <section className="joker-categorie">
      <h3 className="joker-categorie-titre">{t(`jokers.categories.${categorie.id}`)}</h3>
      <div className="joker-categorie-scroller" ref={scrollerRef}>
        {categorie.jokers.map(({ id, Icon }) => (
          <JokerCard
            key={id}
            nom={t(`jokers.${categorie.id}.${id}.nom`)}
            effet={t(`jokers.${categorie.id}.${id}.effet`)}
            illustration={<Icon />}
            colorVar={categorie.colorVar}
            chosen={onChoose ? selectedCarteJokerId === id : undefined}
            onChoose={onChoose ? () => onChoose(id) : undefined}
            chooseLabel={t('jokers.choisir')}
            chosenLabel={t('jokers.choisi')}
          />
        ))}
      </div>
      {categorie.jokers.length > 1 && (
        <div className="joker-categorie-dots" aria-hidden="true">
          {categorie.jokers.map((joker, i) => (
            <span key={joker.id} className={`joker-dot${i === activeIndex ? ' joker-dot--active' : ''}`} />
          ))}
        </div>
      )}
    </section>
  );
}

export default JokerCategorySection;
