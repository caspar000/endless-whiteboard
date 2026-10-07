import { Check, ChevronDown, Copy } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { usePlatform } from '../../platform/PlatformContext'
import {
	changePassword,
	createInvite,
	createMember,
	getMe,
	getVault,
	inviteUrl,
	listInvites,
	logOut,
	removeMember,
	renameVault,
	setMemberRole,
	updateMe,
	withdrawInvite,
	type Invite,
	type Me,
	type Member,
	type VaultRole,
} from '../../server/accounts'

/**
 * Settings → Account (phase 4): who is logged in to the server, the vault they're in and who else is,
 * and the invites that bring people in. A vault's owners also make accounts in it, change who owns
 * it, remove people and rename it. Only there is a server; without one there are no accounts.
 */
export function AccountPanel({ hasServer }: { hasServer: boolean }) {
	const platform = usePlatform()
	const [me, setMe] = useState<Me | null>(null)
	const [members, setMembers] = useState<Member[]>([])
	const [removing, setRemoving] = useState<string | null>(null)
	const [invites, setInvites] = useState<Invite[]>([])
	const [message, setMessage] = useState<string | null>(null)
	const [copied, setCopied] = useState<string | null>(null)

	const load = useCallback(async () => {
		const [who, vault, open] = await Promise.all([getMe(), getVault(), listInvites()])
		setMe(who)
		setMembers(vault.members)
		setInvites(open)
	}, [])

	useEffect(() => {
		if (hasServer) void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
	}, [hasServer, load])

	if (!hasServer) {
		return (
			<section className="lb-settings">
				<p className="lb-settings__hint">
					Accounts belong to a server vault, and this browser isn’t connected to one. Boards here are this
					device’s alone.
				</p>
			</section>
		)
	}
	if (!me) return <section className="lb-settings">{message ?? 'Loading…'}</section>

	const run = (work: () => Promise<unknown>, done?: string) => async () => {
		try {
			await work()
			await load()
			setMessage(done ?? null)
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error))
		}
	}

	const copy = async (token: string) => {
		await navigator.clipboard.writeText(inviteUrl(token))
		setCopied(token)
		setTimeout(() => setCopied((current) => (current === token ? null : current)), 1500)
	}
	const invite = (kind: Invite['kind']) =>
		run(async () => {
			const made = await createInvite(kind)
			await copy(made.token)
		}, 'Invite link copied. It works once, for a week.')

	const onProfile = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const data = new FormData(event.currentTarget)
		void run(() => updateMe({ displayName: String(data.get('displayName')), username: String(data.get('username')) }), 'Saved.')()
	}
	const onPassword = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = event.currentTarget
		const data = new FormData(form)
		void run(async () => {
			await changePassword(String(data.get('current')), String(data.get('next')))
			form.reset()
		}, 'Password changed. Your other devices will ask you to log in again.')()
	}
	const onVault = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		void run(() => renameVault(String(new FormData(event.currentTarget).get('name'))), 'Saved.')()
	}
	const onCreate = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = event.currentTarget
		const data = new FormData(form)
		const username = String(data.get('username'))
		void run(async () => {
			await createMember({ displayName: String(data.get('displayName')), username, password: String(data.get('password')) })
			form.reset()
		}, `Made @${username}. Give them the password; they’ll choose their own when they first log in.`)()
	}
	const isOwner = me.vaultRole === 'owner'

	return (
		<section className="lb-settings lb-account" data-testid="lb.account">
			<h2>You</h2>
			<form className="lb-account__form" onSubmit={onProfile}>
				<label>
					Name <input name="displayName" defaultValue={me.displayName} required maxLength={60} />
				</label>
				<label>
					Username <input name="username" defaultValue={me.username} required autoCapitalize="none" spellCheck={false} />
				</label>
				<button className="lb-btn lb-btn--tiny" type="submit">
					Save
				</button>
			</form>
			<form className="lb-account__form" onSubmit={onPassword}>
				<label>
					Current password <input type="password" name="current" autoComplete="current-password" required />
				</label>
				<label>
					New password <input type="password" name="next" autoComplete="new-password" minLength={12} required />
				</label>
				<button className="lb-btn lb-btn--tiny" type="submit">
					Change password
				</button>
			</form>
			<div className="lb-settings__actions">
				<button className="lb-btn" onClick={() => void logOut(platform.kv)}>
					Log out
				</button>
			</div>
			<p className="lb-settings__hint">Logging out also clears the boards kept on this device for offline use.</p>

			<h2>{isOwner ? 'Your vault' : me.vault.name}</h2>
			<p className="lb-settings__hint">
				Everyone in a vault sees and edits all of its boards. Its owners also add and remove people.
			</p>
			{isOwner && (
				<form className="lb-account__form" onSubmit={onVault}>
					<label>
						Name <input name="name" defaultValue={me.vault.name} required maxLength={200} />
					</label>
					<button className="lb-btn lb-btn--tiny" type="submit">
						Save
					</button>
				</form>
			)}
			<table className="lb-account__table" data-testid="lb.account.members">
				<thead>
					<tr>
						<th>Name</th>
						<th>Username</th>
						<th>Role</th>
						{isOwner && <th aria-label="Actions" />}
					</tr>
				</thead>
				<tbody>
					{members.map((member) => (
						<tr key={member.id}>
							<td>
								{member.displayName}
								{member.id === me.id && <span className="lb-dialog__meta"> (you)</span>}
							</td>
							<td className="lb-dialog__meta">@{member.username}</td>
							<td>
								{isOwner ? (
									<span className="lb-select">
										<select
											value={member.role}
											aria-label={`Role of ${member.displayName}`}
											onChange={(event) => void run(() => setMemberRole(member.id, event.currentTarget.value as VaultRole))()}
										>
											<option value="owner">Owner</option>
											<option value="member">Member</option>
										</select>
										<ChevronDown className="lb-select__caret" size={13} aria-hidden />
									</span>
								) : member.role === 'owner' ? (
									'Owner'
								) : (
									'Member'
								)}
							</td>
							{isOwner && (
								<td className="lb-account__actions">
									{member.id === me.id ? null : removing === member.id ? (
										<>
											<button
												className="lb-btn lb-btn--danger lb-btn--tiny"
												onClick={() => {
													setRemoving(null)
													void run(() => removeMember(member.id), `Removed ${member.displayName}.`)()
												}}
											>
												Remove {member.displayName}
											</button>
											<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={() => setRemoving(null)}>
												Cancel
											</button>
										</>
									) : (
										<button className="lb-btn lb-btn--tiny" onClick={() => setRemoving(member.id)}>
											Remove
										</button>
									)}
								</td>
							)}
						</tr>
					))}
				</tbody>
			</table>
			{isOwner && (
				<>
					<p className="lb-settings__hint">
						Removing someone deletes their account. What they made stays, credited to “a former member”.
					</p>
					<h2>Add someone</h2>
					<p className="lb-settings__hint">
						Make the account here and give them the password. They’ll choose their own when they first log in.
					</p>
					<form className="lb-account__form" onSubmit={onCreate}>
						<label>
							Name <input name="displayName" required maxLength={60} autoComplete="off" />
						</label>
						<label>
							Username{' '}
							<input
								name="username"
								required
								autoCapitalize="none"
								spellCheck={false}
								autoComplete="off"
							/>
						</label>
						<label>
							Password <input name="password" required minLength={12} autoComplete="new-password" />
						</label>
						<button className="lb-btn lb-btn--tiny" type="submit">
							Create account
						</button>
					</form>
				</>
			)}

			<h2>Invites</h2>
			<p className="lb-settings__hint">
				An invite is a link that makes one account, once, within a week. Send it however you like.
			</p>
			<div className="lb-settings__actions">
				<button className="lb-btn" onClick={invite('join')}>
					Invite someone to {me.vault.name}
				</button>
				{me.isAdmin && (
					<button className="lb-btn" onClick={invite('new-vault')}>
						Invite someone with a vault of their own
					</button>
				)}
			</div>
			{invites.length > 0 && (
				<ul className="lb-dialog__list">
					{invites.map((open) => (
						<li key={open.token}>
							<span>{open.kind === 'join' ? `Into ${me.vault.name}` : 'Their own vault'}</span>
							<span className="lb-dialog__meta">until {new Date(open.expiresAt).toLocaleDateString()}</span>
							<button className="lb-btn lb-btn--tiny" onClick={() => void copy(open.token)}>
								{copied === open.token ? <Check size={13} /> : <Copy size={13} />} {copied === open.token ? 'Copied' : 'Copy link'}
							</button>
							<button className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={run(() => withdrawInvite(open.token))}>
								Withdraw
							</button>
						</li>
					))}
				</ul>
			)}

			{message && <p className="lb-settings__message">{message}</p>}
		</section>
	)
}
