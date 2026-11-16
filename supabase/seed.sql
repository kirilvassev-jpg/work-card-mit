-- Fictional data for LOCAL Supabase only. No office account is granted access.
insert into public.nomenclatures(group_name,value,label,sort_order) values
 ('mechanics','Демо механик','Демо механик',1),
 ('mechanics','Втори механик','Втори механик',2),
 ('activity_types','ТО / ППП','ТО / ППП',1),
 ('activity_types','РЕМОНТ','РЕМОНТ',2),
 ('activity_types','ГАРАНЦИОНЕН РЕМОНТ','ГАРАНЦИОНЕН РЕМОНТ',3),
 ('services','Маслен филтър','Маслен филтър',1),
 ('repair_systems','Двигател','Двигател',1),
 ('repair_types','Текущ ремонт','Текущ ремонт',1),
 ('filters','Маслен филтър','Маслен филтър',1),
 ('oils','Двигателно масло','Двигателно масло',1),
 ('antifreezes','Антифриз','Антифриз',1),
 ('bulbs','Крушка H7','Крушка H7',1),
 ('quick_couplings','Бърза връзка','Бърза връзка',1),
 ('teeth','Зъб','Зъб',1)
on conflict(group_name,value) do nothing;
