import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { peopleFor, readTeamForm, teamPayload, validateTeamForm } from './teams.ts';

describe('form team', () => {
  it('đọc thành viên không lặp, không trưởng nhóm thì gửi null', () => {
    const data = new FormData();
    data.set('name', ' Team Sao ');
    data.set('departmentId', 'd1');
    data.set('leaderId', '');
    data.append('memberIds', 'u2');
    data.append('memberIds', 'u1');
    data.append('memberIds', 'u2');
    const values = readTeamForm(data);
    assert.deepEqual(values, {
      name: 'Team Sao',
      departmentId: 'd1',
      leaderId: '',
      memberIds: ['u2', 'u1'],
    });
    assert.deepEqual(validateTeamForm(values), {});
    assert.deepEqual(teamPayload(values), {
      name: 'Team Sao',
      departmentId: 'd1',
      leaderId: null,
      memberIds: ['u2', 'u1'],
    });
  });

  it('báo thiếu tên và phòng ban', () => {
    assert.deepEqual(
      Object.keys(validateTeamForm({ name: '', departmentId: '', leaderId: '', memberIds: [] })),
      ['name', 'departmentId'],
    );
  });
});

describe('peopleFor', () => {
  it('lấy người của phòng ban, giữ thành viên hiện tại kể cả đã ngừng hoạt động', () => {
    const options = {
      departments: [],
      users: [
        { id: 'u2', fullName: 'Bình', email: null, departmentId: 'd1' },
        { id: 'u1', fullName: 'An', email: null, departmentId: 'd1' },
        { id: 'u3', fullName: 'Cường', email: null, departmentId: 'd2' },
      ],
    };
    assert.deepEqual(
      peopleFor(options, 'd1', [
        { id: 'u4', fullName: 'Dũng', email: null, status: 'INACTIVE' },
        { id: 'u1', fullName: 'An', email: null, status: 'ACTIVE' },
      ]),
      [
        { id: 'u1', fullName: 'An', inactive: false },
        { id: 'u2', fullName: 'Bình', inactive: false },
        { id: 'u4', fullName: 'Dũng', inactive: true },
      ],
    );
    assert.deepEqual(
      peopleFor(options, 'd2').map((person) => person.id),
      ['u3'],
    );
  });
});
