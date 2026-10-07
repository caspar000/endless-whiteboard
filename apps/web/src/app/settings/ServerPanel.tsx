import { useValue } from '@lifeboard/canvas'
import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
	adminAccounts,
	adminCreateAccount,
	adminDeleteAccount,
	adminDeleteVault,
	adminRenameVault,
	adminUpdateAccount,
	adminVaults,
	currentAccount,
	type AdminAccount,
	type AdminVault,
	type VaultRole,
} from '../../server/accounts'

const NEW_VAULT = '__new'

/** A `<select>` with the app's own caret. */
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
	return (
		<span className="lb-select">
			<select value={value} aria-label={label} onChange={(event) => onChange(event.currentTarget.value)}>
				{children}
			</select>
			<ChevronDown className="lb-select__caret" size={13} aria-hidden />
		</span>
	)
}

type OpenAccount = { id: string; kind: 'edit' | 'password' | 'delete' } | null
type OpenVault = { id: string; kind: 'rename' | 'delete' } | null

/**
 * Settings → Server, for the server's admin only: every account and vault on the server. The admin
 * creates accounts in any vault or a new one, sets passwords (the person picks their own at the next
 * login), makes others admins, and deletes accounts and vaults.
 */
export function ServerPanel() {
	const meId = useValue('lifeboard:account-id', () => currentAccount.get()?.id ?? null, [])
	const [accounts, setAccounts] = useState<AdminAccount[] | null>(null)
	const [vaults, setVaults] = useState<AdminVault[]>([])
	const [open, setOpen] = useState<OpenAccount>(null)
	const [openVault, setOpenVault] = useState<OpenVault>(null)
	const [message, setMessage] = useState<string | null>(null)

	const load = useCallback(async () => {
		const [all, allVaults] = await Promise.all([adminAccounts(), adminVaults()])
		setAccounts(all)
		setVaults(allVaults)
	}, [])

	useEffect(() => {
		void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
	}, [load])

	if (!accounts) return <section className="lb-settings">{message ?? 'Loading…'}</section>

	/** Does the work, reloads, closes what was open, and says how it went. */
	const run = async (work: () => Promise<unknown>, done: string) => {
		try {
			await work()
			setOpen(null)
			setOpenVault(null)
			await load()
			setMessage(done)
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error))
		}
	}

	const vaultName = (id: string) => vaults.find((vault) => vault.id === id)?.name ?? 'a vault'

	return (
		<section className="lb-settings lb-account" data-testid="lb.server">
			<h2>Accounts</h2>
			<p className="lb-settings__hint">
				Everyone on this server. A password you set is temporary: they choose their own at their next login.
			</p>
			<table className="lb-account__table" data-testid="lb.server.accounts">
				<thead>
					<tr>
						<th>Name</th>
						<th>Username</th>
						<th>Vault</th>
						<th>Role</th>
						<th>Admin</th>
						<th aria-label="Actions" />
					</tr>
				</thead>
				<tbody>
					{accounts.map((account) => {
						const isOpen = open?.id === account.id ? open.kind : null
						const toggle = (kind: NonNullable<OpenAccount>['kind']) => setOpen(isOpen === kind ? null : { id: account.id, kind })
						return [
							<tr key={account.id}>
								<td>
									{account.displayName}
									{account.id === meId && <span className="lb-dialog__meta"> (you)</span>}
								</td>
								<td className="lb-dialog__meta">@{account.username}</td>
								<td>{vaultName(account.vaultId)}</td>
								<td>
									<Select
										label={`Role of ${account.displayName}`}
										value={account.role}
										onChange={(role) =>
											void run(() => adminUpdateAccount(account.id, { role: role as VaultRole }), `${account.displayName} is ${role === 'owner' ? 'an owner' : 'a member'} now.`)
										}
									>
										<option value="owner">Owner</option>
										<option value="member">Member</option>
									</Select>
								</td>
								<td>
									<input
										type="checkbox"
										className="lb-toggle__input"
										checked={account.isAdmin}
										aria-label={`${account.displayName} is an admin`}
										onChange={(event) => {
											const isAdmin = event.currentTarget.checked
											void run(
												() => adminUpdateAccount(account.id, { isAdmin }),
												isAdmin ? `${account.displayName} is an admin now.` : `${account.displayName} isn’t an admin any more.`
											)
										}}
									/>
								</td>
								<td className="lb-account__actions">
									<button className="lb-btn lb-btn--tiny" onClick={() => toggle('edit')}>
										Edit
									</button>
									<button className="lb-btn lb-btn--tiny" onClick={() => toggle('password')}>
										Set password
									</button>
									{account.id !== meId && (
										<button className="lb-btn lb-btn--tiny" onClick={() => toggle('delete')}>
											Delete
										</button>
									)}
								</td>
							</tr>,
							isOpen && (
								<tr key={`${account.id}-open`} className="lb-account__expand">
									<td colSpan={6}>
										{isOpen === 'edit' && <EditAccount account={account} run={run} onCancel={() => setOpen(null)} />}
										{isOpen === 'password' && <SetPassword account={account} run={run} onCancel={() => setOpen(null)} />}
										{isOpen === 'delete' && (
											<DeleteAccount
												account={account}
												others={accounts.filter((other) => other.vaultId === account.vaultId && other.id !== account.id)}
												vault={vaults.find((vault) => vault.id === account.vaultId)}
												run={run}
												onCancel={() => setOpen(null)}
											/>
										)}
									</td>
								</tr>
							),
						]
					})}
				</tbody>
			</table>

			<h2>Create an account</h2>
			<CreateAccount vaults={vaults} run={run} />

			<h2>Vaults</h2>
			<p className="lb-settings__hint">Everyone in a vault sees and edits all of its boards.</p>
			<table className="lb-account__table" data-testid="lb.server.vaults">
				<thead>
					<tr>
						<th>Name</th>
						<th>People</th>
						<th>Boards</th>
						<th aria-label="Actions" />
					</tr>
				</thead>
				<tbody>
					{vaults.map((vault) => {
						const isOpen = openVault?.id === vault.id ? openVault.kind : null
						const mine = accounts.some((account) => account.id === meId && account.vaultId === vault.id)
						return [
							<tr key={vault.id}>
								<td>
									{vault.name}
									{mine && <span className="lb-dialog__meta"> (yours)</span>}
								</td>
								<td>{vault.members}</td>
								<td>{vault.boards}</td>
								<td className="lb-account__actions">
									<button
										className="lb-btn lb-btn--tiny"
										onClick={() => setOpenVault(isOpen === 'rename' ? null : { id: vault.id, kind: 'rename' })}
									>
										Rename
									</button>
									{!mine && (
										<button
											className="lb-btn lb-btn--tiny"
											onClick={() => setOpenVault(isOpen === 'delete' ? null : { id: vault.id, kind: 'delete' })}
										>
											Delete
										</button>
									)}
								</td>
							</tr>,
							isOpen && (
								<tr key={`${vault.id}-open`} className="lb-account__expand">
									<td colSpan={4}>
										{isOpen === 'rename' && <RenameVault vault={vault} run={run} onCancel={() => setOpenVault(null)} />}
										{isOpen === 'delete' && <DeleteVault vault={vault} run={run} onCancel={() => setOpenVault(null)} />}
									</td>
								</tr>
							),
						]
					})}
				</tbody>
			</table>

			{message && <p className="lb-settings__message">{message}</p>}
		</section>
	)
}

type Run = (work: () => Promise<unknown>, done: string) => Promise<void>

function Cancel({ onCancel }: { onCancel: () => void }) {
	return (
		<button type="button" className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={onCancel}>
			Cancel
		</button>
	)
}

function EditAccount({ account, run, onCancel }: { account: AdminAccount; run: Run; onCancel: () => void }) {
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const data = new FormData(event.currentTarget)
		void run(
			() => adminUpdateAccount(account.id, { displayName: String(data.get('displayName')), username: String(data.get('username')) }),
			'Saved.'
		)
	}
	return (
		<form className="lb-account__form" onSubmit={onSubmit}>
			<label>
				Name <input name="displayName" defaultValue={account.displayName} required maxLength={60} />
			</label>
			<label>
				Username <input name="username" defaultValue={account.username} required autoCapitalize="none" spellCheck={false} />
			</label>
			<button className="lb-btn lb-btn--tiny" type="submit">
				Save
			</button>
			<Cancel onCancel={onCancel} />
		</form>
	)
}

function SetPassword({ account, run, onCancel }: { account: AdminAccount; run: Run; onCancel: () => void }) {
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const password = String(new FormData(event.currentTarget).get('password'))
		void run(
			() => adminUpdateAccount(account.id, { password }),
			`${account.displayName} is logged out everywhere, and chooses their own password at the next login.`
		)
	}
	return (
		<form className="lb-account__form" onSubmit={onSubmit}>
			<label>
				Temporary password for {account.displayName} <input name="password" required minLength={12} autoComplete="new-password" />
			</label>
			<button className="lb-btn lb-btn--tiny" type="submit">
				Set password
			</button>
			<Cancel onCancel={onCancel} />
		</form>
	)
}

/**
 * Deleting an account. The last owner of a vault others are still in needs someone to own it next;
 * the last person in a vault can take it along, which takes a typed confirmation.
 */
function DeleteAccount({
	account,
	others,
	vault,
	run,
	onCancel,
}: {
	account: AdminAccount
	others: AdminAccount[]
	vault: AdminVault | undefined
	run: Run
	onCancel: () => void
}) {
	const needsOwner = account.role === 'owner' && others.length > 0 && !others.some((other) => other.role === 'owner')
	const isLast = others.length === 0
	const [newOwner, setNewOwner] = useState(others[0]?.id ?? '')
	const [alsoVault, setAlsoVault] = useState(false)
	const [typed, setTyped] = useState('')
	const name = vault?.name ?? 'their vault'
	const boards = vault?.boards ?? 0
	const ready = !alsoVault || typed === vault?.name

	return (
		<div className="lb-account__confirm">
			{needsOwner ? (
				<label className="lb-account__inline">
					{account.displayName} is the last owner of {name}. Who owns it next?
					<Select label="New owner" value={newOwner} onChange={setNewOwner}>
						{others.map((other) => (
							<option key={other.id} value={other.id}>
								{other.displayName}
							</option>
						))}
					</Select>
				</label>
			) : isLast ? (
				<>
					<label className="lb-account__inline">
						<input type="checkbox" checked={alsoVault} onChange={(event) => setAlsoVault(event.currentTarget.checked)} />
						Also delete {name} and its {boards} {boards === 1 ? 'board' : 'boards'}. Otherwise it stays, with nobody in it.
					</label>
					{alsoVault && (
						<label className="lb-account__inline">
							Type “{name}” to confirm
							<input value={typed} onChange={(event) => setTyped(event.currentTarget.value)} aria-label="Vault name to confirm" />
						</label>
					)}
				</>
			) : (
				<p>Delete {account.displayName}’s account? They’re logged out at once. What they made stays.</p>
			)}
			<div className="lb-settings__actions">
				<button
					className="lb-btn lb-btn--danger lb-btn--tiny"
					disabled={!ready}
					onClick={() =>
						void run(
							() => adminDeleteAccount(account.id, { ...(needsOwner ? { newOwner } : {}), deleteVault: isLast && alsoVault }),
							`Deleted ${account.displayName}${isLast && alsoVault ? ` and ${name}` : ''}.`
						)
					}
				>
					Delete {account.displayName}
				</button>
				<Cancel onCancel={onCancel} />
			</div>
		</div>
	)
}

function RenameVault({ vault, run, onCancel }: { vault: AdminVault; run: Run; onCancel: () => void }) {
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const name = String(new FormData(event.currentTarget).get('name'))
		void run(() => adminRenameVault(vault.id, name), 'Saved.')
	}
	return (
		<form className="lb-account__form" onSubmit={onSubmit}>
			<label>
				Name <input name="name" defaultValue={vault.name} required maxLength={200} />
			</label>
			<button className="lb-btn lb-btn--tiny" type="submit">
				Save
			</button>
			<Cancel onCancel={onCancel} />
		</form>
	)
}

function DeleteVault({ vault, run, onCancel }: { vault: AdminVault; run: Run; onCancel: () => void }) {
	const [typed, setTyped] = useState('')
	const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
	return (
		<div className="lb-account__confirm">
			<p>
				This deletes {vault.name}, its {count(vault.boards, 'board', 'boards')} and the{' '}
				{count(vault.members, 'account', 'accounts')} in it. It can’t be undone.
			</p>
			<label className="lb-account__inline">
				Type “{vault.name}” to confirm
				<input value={typed} onChange={(event) => setTyped(event.currentTarget.value)} aria-label="Vault name to confirm" />
			</label>
			<div className="lb-settings__actions">
				<button
					className="lb-btn lb-btn--danger lb-btn--tiny"
					disabled={typed !== vault.name}
					onClick={() => void run(() => adminDeleteVault(vault.id), `Deleted ${vault.name}.`)}
				>
					Delete {vault.name}
				</button>
				<Cancel onCancel={onCancel} />
			</div>
		</div>
	)
}

/** A new account, in any vault or a new one. A new vault's first person owns it. */
function CreateAccount({ vaults, run }: { vaults: AdminVault[]; run: Run }) {
	const [target, setTarget] = useState(NEW_VAULT)
	const [role, setRole] = useState<VaultRole>('owner')
	const pickVault = (value: string) => {
		setTarget(value)
		setRole(value === NEW_VAULT ? 'owner' : 'member')
	}
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		const form = event.currentTarget
		const data = new FormData(form)
		const username = String(data.get('username'))
		void run(async () => {
			await adminCreateAccount({
				displayName: String(data.get('displayName')),
				username,
				password: String(data.get('password')),
				role,
				isAdmin: data.get('isAdmin') === 'on',
				...(target === NEW_VAULT ? { newVault: String(data.get('newVault')) } : { vaultId: target }),
			})
			form.reset()
			pickVault(NEW_VAULT)
		}, `Made @${username}. Give them the password; they’ll choose their own when they first log in.`)
	}
	return (
		<form className="lb-account__form" onSubmit={onSubmit} data-testid="lb.server.create">
			<label>
				Name <input name="displayName" required maxLength={60} autoComplete="off" />
			</label>
			<label>
				Username <input name="username" required autoCapitalize="none" spellCheck={false} autoComplete="off" />
			</label>
			<label>
				Temporary password <input name="password" required minLength={12} autoComplete="new-password" />
			</label>
			<label>
				Vault
				<Select label="Vault" value={target} onChange={pickVault}>
					<option value={NEW_VAULT}>New vault…</option>
					{vaults.map((vault) => (
						<option key={vault.id} value={vault.id}>
							{vault.name}
						</option>
					))}
				</Select>
			</label>
			{target === NEW_VAULT && (
				<label>
					New vault’s name <input name="newVault" required maxLength={200} />
				</label>
			)}
			<label>
				Role
				<Select label="Role" value={role} onChange={(value) => setRole(value as VaultRole)}>
					<option value="owner">Owner</option>
					<option value="member">Member</option>
				</Select>
			</label>
			<label className="lb-account__inline">
				<input type="checkbox" name="isAdmin" /> Server admin
			</label>
			<button className="lb-btn lb-btn--tiny" type="submit">
				Create account
			</button>
		</form>
	)
}
