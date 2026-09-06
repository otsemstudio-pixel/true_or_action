import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import ScoreBoard from '../components/ScoreBoard.jsx';
import Wheel from '../components/Wheel.jsx';
import TurnPanel from '../components/TurnPanel.jsx';
import SurpriseTurnPanel from '../components/SurpriseTurnPanel.jsx';
import PariMutuelPanel from '../components/PariMutuelPanel.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import ResultToast from '../components/ResultToast.jsx';
import RecapPanel from '../components/RecapPanel.jsx';
import ReglesActives from '../components/ReglesActives.jsx';
import Button from '../components/Button.jsx';

function PartieScreen() {
  const { user } = useAuth();
  const {
    room,
    sendAnswer,
    sendVote,
    sendChat,
    sendPass,
    chooseQuestion,
    respondNiveauChoice,
    returnQuestionAction,
    sendBet,
    judgeBet,
    sendSurpriseAnswer,
    sendSurpriseVote,
  } = useRoom();
  const { t } = useI18n();
  const myId = String(user.id);
  const [recapOpen, setRecapOpen] = useState(false);
  const isSurprise = room.currentTurn?.mode === 'surprise';

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

        <ReglesActives regles={room.regles} />

        <ResultToast result={room.lastResult} players={room.players} />

        <Wheel type={room.currentTurn?.type} turnNumber={room.currentTurn?.turnNumber} />

        {isSurprise ? (
          <SurpriseTurnPanel
            turn={room.currentTurn}
            players={room.players}
            myId={myId}
            answerSec={room.answerSec}
            onSubmitAnswer={sendSurpriseAnswer}
            onVote={sendSurpriseVote}
          />
        ) : (
          <>
            <TurnPanel
              turn={room.currentTurn}
              players={room.players}
              myId={myId}
              regles={room.regles}
              answerSec={room.answerSec}
              onSubmitAnswer={sendAnswer}
              onPass={sendPass}
              onChooseQuestion={chooseQuestion}
              onRespondNiveauChoice={respondNiveauChoice}
              onReturnQuestion={returnQuestionAction}
              onJudgeBet={judgeBet}
            />
            {room.regles.pariMutuel && (
              <PariMutuelPanel turn={room.currentTurn} players={room.players} myId={myId} onSendBet={sendBet} />
            )}
          </>
        )}
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
