import { useState } from 'react'
import { EXAMPLE_DOMAINS, type ExampleDomain } from './exampleDomains'
import { MockCard, StripValue } from './MockCard'
import { Keys, Tabs } from './kit'

/**
 * The Properties section's playground: two unrelated boards, one widget, real answers.
 *
 * Interactive rather than animated because the thing being demonstrated is a *system*, and a loop can
 * only show one path through a system. Here the reader picks the board, picks the card, picks the
 * question — and the number under it is computed from the cards on screen (see `exampleDomains.ts`), so
 * poking at it can't produce something that isn't true.
 */
export function DomainExample() {
	const [domainId, setDomainId] = useState(EXAMPLE_DOMAINS[0]!.id)
	const domain = EXAMPLE_DOMAINS.find((d) => d.id === domainId) ?? EXAMPLE_DOMAINS[0]!
	return <DomainBoard key={domain.id} domain={domain} onDomain={setDomainId} />
}

/**
 * One board's worth of the widget.
 *
 * Keyed by domain id above, so switching boards remounts it: the selected card and the asked question
 * both belong to a specific board, and carrying an index across would land on whatever happened to be
 * in that position on the other one.
 */
function DomainBoard({ domain, onDomain }: { domain: ExampleDomain; onDomain: (id: string) => void }) {
	const [cardId, setCardId] = useState(domain.cards[0]!.id)
	const [questionId, setQuestionId] = useState(domain.questions[0]!.id)

	const card = domain.cards.find((c) => c.id === cardId) ?? domain.cards[0]!
	const question = domain.questions.find((q) => q.id === questionId) ?? domain.questions[0]!
	const answer = question.run(domain.cards)

	return (
		<div className="lb-ex">
			<Tabs
				label="Example board"
				value={domain.id}
				options={EXAMPLE_DOMAINS.map((d) => ({ id: d.id, label: d.label }))}
				onChange={onDomain}
			/>
			<p className="lb-ex__blurb">{domain.blurb}</p>

			<div className="lb-ex__board">
				<div className="lb-ex__cards" role="group" aria-label="Shapes on this board">
					{domain.cards.map((c) => (
						<MockCard
							key={c.id}
							card={c}
							properties={domain.properties}
							selected={c.id === card.id}
							onSelect={() => setCardId(c.id)}
						/>
					))}
				</div>

				{/* The properties panel, as ⌥P opens it on the selected card. */}
				<div className="lb-ex__panel">
					<div className="lb-ex__panelhead">
						<span className="lb-ex__paneltitle">{card.name}</span>
						<Keys keys={['⌥P']} />
					</div>
					{domain.properties.map((def) => (
						<div className="lb-ex__panelrow" key={def.id}>
							<span className="lb-ex__panelname">
								{def.name}
								<span className="lb-ex__paneltype">{def.type}</span>
							</span>
							<span className="lb-ex__panelvalue">
								<StripValue
									def={def}
									value={card.values[def.id] ?? null}
									unit={card.units?.[def.id]}
								/>
							</span>
						</div>
					))}
					<div className="lb-ex__panelrow lb-ex__panelrow--faint">+ Add a property</div>
					<div className="lb-ex__panelfoot">
						Every shape on this board is offered the same five properties — the definitions belong to
						the board. An empty one costs nothing and shows nothing.
					</div>
				</div>
			</div>

			<div className="lb-ex__ask">
				<div className="lb-ex__asklabel">Ask this board</div>
				<div className="lb-ex__askrow">
					{domain.questions.map((q) => (
						<button
							key={q.id}
							className={
								q.id === question.id ? 'lb-ex__askbtn lb-ex__askbtn--on' : 'lb-ex__askbtn'
							}
							aria-pressed={q.id === question.id}
							onClick={() => setQuestionId(q.id)}
						>
							{q.label}
						</button>
					))}
				</div>
			</div>

			<div className="lb-ex__answer">
				<div className="lb-ex__answervalue">{answer.value}</div>
				<div className="lb-ex__answernote">{answer.note}</div>
				{question.expression && (
					<div className="lb-ex__answerexpr">
						Anywhere you can type: <code>{question.expression}</code>
					</div>
				)}
			</div>

		</div>
	)
}
