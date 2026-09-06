import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import ScoreBoard from '../components/ScoreBoard.jsx';
import Wheel from '../components/Wheel.jsx';
import TurnPanel from '../components/TurnPanel.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ResultToast from '../components/ResultToast.jsx';
import RecapPanel from '../components/RecapPanel.jsx';
import Button from '../components/Button.jsx';

function PartieScreen() {
  const { user } = useAuth();
  const { room, sendAnswer, sendVote, sendChat } = useRoom();
  const { t } = useI18n();
  const myId = String(user.id);
  const [recapOpen, setRecapOpen] = useState(false);

  return (
    <div className="screen partie-screen">
      <div className="partie-main">
        <ScoreBoard players={room.players} activePlayerId={room.currentTurn?.activePlayerId} />

        <div className="partie-toolbar">
          <p className="niveau-indicator">{t(`niveau.label.${room.niveauMax}`)}</p>
          <Button variant="ghost" onClick={() => setRecapOpen(true)}>
            {t('partie.recapitulatif')}
          </Button>
        </div>

        <ResultToast result={room.lastResult} players={room.players} />

        <Wheel type={room.currentTurn?.type} turnNumber={room.currentTurn?.turnNumber} />

        <TurnPanel turn={room.currentTurn} players={room.players} myId={myId} onSubmitAnswer={sendAnswer} />
      </div>

      <div className="partie-chat-col">
        <ChatPanel
          messages={room.messages}
          players={room.players}
          myId={myId}
          currentTurn={room.currentTurn}
          onSend={sendChat}
          onVote={sendVote}
        />
      </div>

      <RecapPanel open={recapOpen} onClose={() => setRecapOpen(false)} />
    </div>
  );
}

export default PartieScreen;
